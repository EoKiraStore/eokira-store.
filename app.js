import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseApp = initializeApp({
  apiKey: "AIzaSyDin9ClqtwrbiXQ0JugerTttEwa6pMh9es",
  authDomain: "eokirastore.firebaseapp.com",
  projectId: "eokirastore",
  storageBucket: "eokirastore.firebasestorage.app",
  messagingSenderId: "20118408183",
  appId: "1:20118408183:web:7c93a13da00a3e71c63cf2",
});

const API_URL = "https://eokira-store-api.contadvzadas202020.workers.dev";
const auth = getAuth(firebaseApp);
const firestoreDb = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();
const $ = selector => document.querySelector(selector);
const state = { user: null, account: null, isAdmin: false, products: new Map(), productsRetryCount: 0, discountConfig: { active: false }, cart: [], orders: [], tickets: [], customerView: "tickets", activeTicketId: null, unsubscribeMessages: null, messageSending: false, adminOrders: [], adminTickets: [], adminTicketActors: {}, adminTicketNextPageToken: null, adminSelectedTicketId: null, adminCustomers: {}, adminEvents: {}, adminEventActors: {}, adminSearch: "", adminStatus: "ALL", adminTicketSearch: "", adminTicketStatus: "ALL", adminSelectedOrderId: null, adminView: "orders", auditLogs: [], auditActors: {}, auditSearch: "", auditCategory: "ALL", auditPeriod: "ALL", auditNextPageToken: null, auditLoading: false, checkoutAttemptId: null, adminActionInFlight: false, cancelInFlight: false, submitting: false };
const overlay = $("#overlay");
const drawer = $("#cart-drawer");
let paymentPollTimer = null;
let paymentPollOrderId = null;
let paymentPollBusy = false;
const supportConversation = [];

function currencyFromCents(value) {
  return (Number(value || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function show(element) {
  if (!element) return;
  element.classList.add("is-open");
  overlay?.classList.add("is-open");
}

function hideAll() {
  stopMessageListener();
  stopPaymentPolling();
  document.querySelectorAll(".drawer.is-open, .modal.is-open, .products.is-open, .overlay.is-open")
    .forEach(element => element.classList.remove("is-open"));
}

function openLoginModal() {
  hideAll();
  show($("#login-modal"));
  $("#login-email")?.focus();
}

function notify(message, kind = "info") {
  let toast = $("#site-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "site-toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.className = `site-toast ${kind}`;
  toast.textContent = message;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("is-visible"), 4500);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
}

function renderSupportConversation() {
  const list = $("#support-ai-messages");
  if (!list) return;
  const messages = supportConversation.length
    ? supportConversation
    : [{ role: "assistant", text: "Oi! Posso ajudar com produtos, PIX, pedidos, desconto e tickets." }];
  list.innerHTML = messages.map(message => `<article class="support-message ${message.role === "user" ? "user" : "assistant"}">${escapeHtml(message.text)}</article>`).join("");
  list.scrollTop = list.scrollHeight;
}

function freeSupportReply(message) {
  const text = message.toLocaleLowerCase("pt-BR");
  if (/(confi[aá]vel|seguro|seguran[cç]a|golpe|confiar)/.test(text)) return "Use sempre o endereço oficial da EoKira. Os preços e pedidos são conferidos pelo servidor, e o PIX é gerado para cada pedido. A loja nunca deve pedir senha, código PIX, token ou dados bancários pelo chat.";
  if (/(pix|pagar|pagamento|qr|copia e cola)/.test(text)) return "Depois de criar o pedido, gere o PIX exclusivo dele. O pagamento só é confirmado quando o Mercado Pago avisar o servidor. Não envie comprovantes, senhas ou códigos.";
  if (/(ticket|atendimento|suporte)/.test(text)) return "Após o pagamento confirmado, o ticket abre automaticamente. Em Meus Tickets você acompanha o atendimento e conversa com a loja.";
  if (/(pedido|acompanhar|status)/.test(text)) return "Use Meus Pedidos para ver o status e Meus Tickets para acompanhar o atendimento depois da confirmação.";
  if (/(desconto|promo)/.test(text)) return "A primeira compra elegível pode receber 10% de desconto. O valor oficial é conferido pelo servidor antes do pedido.";
  if (/(produto|power|roll|won|melhoria|comprar)/.test(text)) return "Você encontra Farm de Melhorias, Farm de Wons e Power Rolls na área de Produtos. Escolha a quantidade e adicione ao carrinho.";
  return "Posso ajudar com produtos, PIX, pedidos, descontos e tickets. Tente perguntar, por exemplo: 'Como funciona o PIX?'";
}

function sendSupportMessage(event) {
  event.preventDefault();
  const input = $("#support-ai-input");
  const message = String(input?.value || "").trim();
  if (message.length < 2) return;
  supportConversation.push({ role: "user", text: message });
  renderSupportConversation();
  input.value = "";
  setTimeout(() => {
    supportConversation.push({ role: "assistant", text: freeSupportReply(message) });
    renderSupportConversation();
  }, 120);
}

function askSupportQuestion(question) {
  supportConversation.push({ role: "user", text: question });
  renderSupportConversation();
  setTimeout(() => {
    supportConversation.push({ role: "assistant", text: freeSupportReply(question) });
    renderSupportConversation();
  }, 120);
}

async function api(path, options = {}, authenticated = true) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (authenticated) {
    if (!state.user) throw new Error("Faça login para continuar.");
    headers.Authorization = `Bearer ${await state.user.getIdToken()}`;
  }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
  return data;
}

async function enterWithGoogle() {
  try {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, googleProvider);
    hideAll();
  } catch (error) {
    const message = error.code === "auth/unauthorized-domain"
      ? "O domínio do site ainda precisa ser autorizado no Firebase."
      : "Não foi possível entrar com o Google.";
    notify(message, "error");
  }
}

async function requireSignedIn() {
  if (state.user) return true;
  openLoginModal();
  return false;
}

function updateAccountButton() {
  const buttons = document.querySelectorAll("[data-auth]");
  document.querySelectorAll("[data-open-admin]").forEach(item => { item.hidden = !state.isAdmin; });
  if (!buttons.length) return;
  if (!state.user) {
    buttons.forEach(button => {
      button.textContent = button.classList.contains("side-account") ? "Entrar" : "Entrar com Google";
      button.classList.remove("admin");
      button.title = "";
    });
    return;
  }
  const isAdmin = state.isAdmin;
  const firstName = state.user.displayName?.split(" ")[0] || "Minha conta";
  buttons.forEach(button => {
    button.textContent = isAdmin ? "Admin · Sair" : `${firstName} · Sair`;
    button.classList.toggle("admin", isAdmin);
    button.title = state.user.email || "";
  });
}

function profileInitials(name) {
  const words = String(name || "EoKira").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(word => word[0]).join("").toUpperCase().slice(0, 2) || "EO";
}

function updateProfileCard() {
  const account = state.account || {};
  const name = account.profileName || state.user?.displayName || "Minha conta";
  const avatar = $("#side-profile-avatar");
  const card = $("[data-open-profile]");
  if (avatar) avatar.textContent = profileInitials(name);
  if (card) card.dataset.color = account.profileColor || "violet";
  const nameNode = $("#side-profile-name");
  const roleNode = $("#side-profile-role");
  const bioNode = $("#side-profile-bio");
  if (nameNode) nameNode.textContent = name;
  if (roleNode) roleNode.textContent = state.isAdmin ? "ADMIN" : "CLIENTE";
  if (bioNode) bioNode.textContent = account.profileBio || (state.user ? "Personalize seu perfil" : "Entre para personalizar");
}

function openProfile() {
  if (!state.user) return openLoginModal();
  const account = state.account || {};
  $("#profile-name").value = account.profileName || state.user.displayName || "";
  $("#profile-bio").value = account.profileBio || "";
  const color = account.profileColor || "violet";
  const selectedColor = $(`#profile-form input[name="profile-color"][value="${color}"]`);
  if (selectedColor) selectedColor.checked = true;
  hideAll();
  show($("#profile-modal"));
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const payload = {
    name: $("#profile-name").value,
    bio: $("#profile-bio").value,
    color: form.querySelector('input[name="profile-color"]:checked')?.value || "violet",
  };
  button.disabled = true;
  try {
    const profile = await api("/account/profile", { method: "POST", body: JSON.stringify(payload) });
    state.account = { ...(state.account || {}), profileName: profile.profileName, profileBio: profile.profileBio, profileColor: profile.profileColor };
    updateProfileCard();
    hideAll();
    notify("Perfil salvo com sucesso.", "success");
  } catch (error) {
    notify(error.message || "Não foi possível salvar o perfil.", "error");
  } finally {
    button.disabled = false;
  }
}

async function loadAccount() {
  if (!state.user) return;
  try {
    state.account = await api("/account");
  } catch (error) {
    state.account = null;
    notify(error.message, "error");
  }
  updateAccountButton();
  updateProfileCard();
}

async function loadProducts() {
  try {
    const data = await api("/products", {}, false);
    state.products = new Map(data.products.map(product => [product.id, product]));
    state.discountConfig = data.discountConfig || { active: false };
    state.productsRetryCount = 0;
    updateDisplayedPrices();
    renderCart();
  } catch (error) {
    if (state.productsRetryCount < 3) {
      state.productsRetryCount += 1;
      setTimeout(loadProducts, state.productsRetryCount * 2000);
      return;
    }
    notify("Não foi possível carregar os preços do servidor. Atualize a página e tente novamente.", "error");
  }
}

function product(productId) {
  return state.products.get(productId);
}

function updateDisplayedPrices() {
  const improvement = product("farm_melhorias");
  const wons = product("farm_wons_1b");
  const roll = product("power_roll");
  if (improvement) $("[data-product='farm_melhorias']")?.closest(".card-bottom")?.querySelector("strong")?.replaceChildren(currencyFromCents(improvement.priceCents));
  if (wons) {
    const price = $("[data-wons]")?.closest(".card-bottom")?.querySelector("strong");
    if (price) price.textContent = `${currencyFromCents(wons.priceCents)} por 1B`;
    if (wonsQuantity) wonsQuantity.max = String(wons.maxQuantity);
  }
  if (roll) {
    const price = $("[data-power-roll]")?.closest(".card-bottom")?.querySelector("strong");
    if (price) price.textContent = `${currencyFromCents(roll.priceCents)} cada`;
    if (rollQuantity) rollQuantity.max = String(roll.maxQuantity);
  }
  updateWonsPrice();
  updateRollPrice();
}

async function addItem(productId, quantity) {
  let itemProduct = product(productId);
  if (!itemProduct) {
    await loadProducts();
    itemProduct = product(productId);
    if (!itemProduct) {
      notify("Não foi possível carregar esse produto. Atualize a página e tente novamente.", "error");
      return;
    }
  }
  const requested = Math.max(1, Math.floor(Number(quantity) || 1));
  const maximum = Number(itemProduct.maxQuantity || 1);
  const existing = state.cart.find(item => item.productId === productId);
  const combined = (existing?.quantity || 0) + requested;
  if (combined > maximum) {
    notify(`O limite desse produto é ${maximum}.`, "error");
    return;
  }
  if (existing) existing.quantity = combined;
  else state.cart.push({ productId, name: itemProduct.name, quantity: requested, unitPriceCents: itemProduct.priceCents, discountEligible: itemProduct.discountEligible === true });
  renderCart();
  hideAll();
  show(drawer);
}

function discountAvailableForPreview() {
  if (!state.account || state.account.discountState === "AVAILABLE") return true;
  if (state.account.discountState !== "RESERVED" || !state.account.discountExpiresAt) return false;
  return new Date(state.account.discountExpiresAt) <= new Date();
}

function previewFinancials() {
  const subtotalCents = state.cart.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const discountBaseCents = state.cart.reduce((sum, item) => sum + (item.discountEligible ? item.unitPriceCents * item.quantity : 0), 0);
  const config = state.discountConfig;
  const eligible = discountAvailableForPreview() && config.active === true && subtotalCents >= Number(config.minSubtotalCents || 0) && discountBaseCents > 0;
  const calculated = eligible ? Math.floor(discountBaseCents * Number(config.percent || 0) / 100) : 0;
  const discountCents = Math.min(calculated, Number(config.maxDiscountCents || 0));
  return { subtotalCents, discountBaseCents, discountCents, totalCents: subtotalCents - discountCents };
}

function renderCart() {
  const preview = previewFinancials();
  const count = state.cart.length;
  if ($("#cart-count")) $("#cart-count").textContent = count;
  if ($("#side-cart-count")) $("#side-cart-count").textContent = count;
  $("#cart-total").textContent = currencyFromCents(preview.totalCents);
  $("#checkout-button").disabled = count === 0 || state.submitting;
  $("#cart-items").innerHTML = count
    ? `${state.cart.map((item, index) => `
      <div class="cart-item">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <small>${item.quantity} × ${currencyFromCents(item.unitPriceCents)}</small>
        </div>
        <button data-remove="${index}" aria-label="Remover ${escapeHtml(item.name)}">×</button>
      </div>`).join("")}
      <div class="discount-row"><span>Subtotal estimado</span><strong>${currencyFromCents(preview.subtotalCents)}</strong></div>
      ${preview.discountCents ? `<div class="discount-row"><span>Desconto estimado</span><strong>− ${currencyFromCents(preview.discountCents)}</strong></div>` : ""}
      <p class="server-price-note">Prévia apenas. O servidor recalcula e confirma todos os valores.</p>`
    : '<p class="empty">Seu carrinho está vazio.</p>';
  document.querySelectorAll("[data-remove]").forEach(button => {
    button.onclick = () => {
      state.cart.splice(Number(button.dataset.remove), 1);
      renderCart();
    };
  });
}

function renderCheckoutSummary() {
  const summary = $("#checkout-summary");
  if (!summary) return;
  const preview = previewFinancials();
  summary.innerHTML = `${state.cart.map(item => `<p><span>${item.quantity} × ${escapeHtml(item.name)}</span><strong>${currencyFromCents(item.unitPriceCents * item.quantity)}</strong></p>`).join("")}
    <p><span>Subtotal estimado</span><strong>${currencyFromCents(preview.subtotalCents)}</strong></p>
    ${preview.discountCents ? `<p><span>Desconto estimado</span><strong>− ${currencyFromCents(preview.discountCents)}</strong></p>` : ""}
    <p class="checkout-total"><span>Total estimado</span><strong>${currencyFromCents(preview.totalCents)}</strong></p>
    <small>O valor oficial será retornado pelo servidor.</small>`;
}

async function submitOrders(event) {
  event.preventDefault();
  if (state.submitting || !state.cart.length) return;
  if (!(await requireSignedIn())) return;
  state.submitting = true;
  state.checkoutAttemptId ||= crypto.randomUUID().replaceAll("-", "");
  const button = event.currentTarget.querySelector("button[type='submit']");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Calculando no servidor...";
  try {
    const order = await api("/createOrder", {
      method: "POST",
      body: JSON.stringify({ checkoutId: state.checkoutAttemptId, items: state.cart.map(item => ({ productId: item.productId, quantity: item.quantity })) }),
    });
    state.cart = [];
    state.checkoutAttemptId = null;
    await loadAccount();
    renderCart();
    hideAll();
    const discountMessage = order.discountCents > 0 ? ` Desconto reservado: ${currencyFromCents(order.discountCents)}.` : "";
    notify(order.alreadyApplied ? "Pedido já havia sido registrado e foi recuperado com segurança." : `Pedido criado por ${currencyFromCents(order.totalCents)}.${discountMessage}`, "success");
    await openOrders();
  } catch (error) {
    notify(error.message || "Não foi possível criar o pedido.", "error");
  } finally {
    state.submitting = false;
    button.disabled = false;
    button.textContent = original;
    renderCart();
  }
}

function statusLabel(status) {
  return ({ CREATED: "CRIADO", AWAITING_PAYMENT: "AGUARDANDO PAGAMENTO", PAYMENT_FOUND: "PAGAMENTO LOCALIZADO", PAYMENT_CONFIRMED: "PAGAMENTO CONFIRMADO", TICKET_OPEN: "TICKET ABERTO", IN_PROGRESS: "EM ANDAMENTO", COMPLETED: "CONCLUÍDO", PAYMENT_EXPIRED: "PAGAMENTO EXPIRADO", CANCELLED: "CANCELADO", REFUNDED: "REEMBOLSADO" })[status] || status || "EM ANÁLISE";
}

function formatDateTime(value) {
  if (!value) return "Data não disponível";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "Data não disponível" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function orderProduct(order) {
  return order.items?.length
    ? order.items.map(item => `${item.quantity} × ${item.name}`).join(" + ")
    : "Pedido";
}

function ticketStatusLabel(status) {
  return ({ OPEN: "ABERTO", IN_PROGRESS: "EM ATENDIMENTO", CLOSED: "FECHADO", ARCHIVED: "ARQUIVADO" })[status] || "ABERTO";
}

function customerTabs() {
  return `<div class="customer-tabs"><button type="button" class="customer-tab ${state.customerView === "tickets" ? "is-active" : ""}" data-customer-view="tickets">Meus tickets</button><button type="button" class="customer-tab ${state.customerView === "orders" ? "is-active" : ""}" data-customer-view="orders">Meus pedidos</button></div>`;
}

function renderOrders() {
  const list = $("#tickets-list");
  if (!state.user) {
    list.innerHTML = '<div class="empty-info"><span>◌</span><strong>Entre para ver seus tickets</strong><p>Seus tickets ficam ligados à sua conta Google.</p><button class="button primary" data-login-orders>Entrar com Google <span>→</span></button></div>';
    $("[data-login-orders]")?.addEventListener("click", async () => {
      if (await requireSignedIn()) await openOrders();
    });
    return;
  }
  if (state.customerView === "tickets") {
    list.innerHTML = `${customerTabs()}${state.tickets.length ? state.tickets.map(ticket => `
      <article class="ticket ticket-new">
        <div class="ticket-orb">◌</div>
        <div class="ticket-data"><span class="ticket-status pending">${escapeHtml(ticketStatusLabel(ticket.status))}</span><h3>#${escapeHtml(ticket.id.slice(-10).toUpperCase())} · ${escapeHtml(ticket.productSummary || "Atendimento")}${Number(ticket.customerUnreadCount || 0) ? ` <b class="ticket-unread">${Number(ticket.customerUnreadCount || 0)} nova${Number(ticket.customerUnreadCount || 0) === 1 ? "" : "s"}</b>` : ""}</h3><p>${escapeHtml(ticket.lastMessagePreview || `Pedido #${ticket.orderId.slice(0, 10).toUpperCase()}`)}</p><small>${ticket.lastMessageAt ? `Última mensagem em ${escapeHtml(formatDateTime(ticket.lastMessageAt))}` : `Atualizado em ${escapeHtml(formatDateTime(ticket.updatedAt))}`}</small></div>
        <button data-ticket="${escapeHtml(ticket.id)}">Ver ticket →</button>
      </article>`).join("") : '<div class="empty-info"><span>◌</span><strong>Nenhum ticket aberto</strong><p>Quando o atendimento do seu pedido for liberado, ele aparecerá aqui.</p></div>'}`;
    document.querySelectorAll("[data-ticket]").forEach(button => button.onclick = () => openTicket(button.dataset.ticket));
  } else list.innerHTML = `${customerTabs()}${state.orders.length ? state.orders.map(order => `
    <article class="ticket ticket-new">
      <div class="ticket-orb">⌛</div>
      <div class="ticket-data">
        <span class="ticket-status pending">${escapeHtml(statusLabel(order.status))}</span>
        <h3>#${escapeHtml(order.id.slice(0, 10).toUpperCase())} · ${escapeHtml(orderProduct(order))}</h3>
        <p>Subtotal ${currencyFromCents(order.subtotalCents)} · Desconto ${currencyFromCents(order.discountCents)} · Total ${currencyFromCents(order.totalCents)}</p>
        <small>${escapeHtml(order.paymentStatus || "UNPAID")} · valores congelados no pedido</small>
      </div>
      <button data-order="${escapeHtml(order.id)}">Ver pedido →</button>
    </article>`).join("") : '<p class="empty">Você ainda não possui pedidos. Finalize sua compra para começar.</p>'}`;
  document.querySelectorAll("[data-customer-view]").forEach(button => button.onclick = () => { state.customerView = button.dataset.customerView; renderOrders(); });
  document.querySelectorAll("[data-order]").forEach(button => button.onclick = () => openOrder(button.dataset.order));
}

async function openOrders() {
  hideAll();
  show($("#tickets-modal"));
  const list = $("#tickets-list");
  if (!state.user) {
    renderOrders();
    return;
  }
  list.innerHTML = '<p class="empty">Carregando seus tickets...</p>';
  try {
    const [orders, tickets] = await Promise.all([api("/orders"), api("/tickets")]);
    state.orders = orders.orders || [];
    state.tickets = tickets.tickets || [];
    renderOrders();
  } catch (error) {
    list.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

function stopMessageListener() {
  if (typeof state.unsubscribeMessages === "function") state.unsubscribeMessages();
  state.unsubscribeMessages = null;
  state.activeTicketId = null;
}

function renderTicketMessages(ticketId, messages) {
  const container = $("#ticket-messages");
  if (!container || state.activeTicketId !== ticketId) return;
  container.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Ainda não há mensagens. Inicie a conversa quando precisar.";
    container.appendChild(empty);
    return;
  }
  for (const message of messages) {
    const article = document.createElement("article");
    const isMine = message.senderUid === state.user?.uid;
    article.className = `message ${isMine ? "mine" : ""} ${message.senderRole === "ADMIN" ? "admin" : "customer"}`.trim();
    const meta = document.createElement("small");
    meta.textContent = `${message.senderRole === "ADMIN" ? "Atendimento" : "Cliente"} · ${formatDateTime(message.createdAt)}`;
    const text = document.createElement("p");
    text.textContent = message.text || "";
    article.append(meta, text);
    container.appendChild(article);
  }
  container.scrollTop = container.scrollHeight;
}

function startMessageListener(ticket) {
  stopMessageListener();
  state.activeTicketId = ticket.id;
  const messageQuery = query(collection(firestoreDb, "tickets", ticket.id, "messages"), orderBy("createdAt", "asc"), limit(100));
  let firstSnapshot = true;
  state.unsubscribeMessages = onSnapshot(messageQuery, snapshot => {
    renderTicketMessages(ticket.id, snapshot.docs.map(document => ({ id: document.id, ...document.data({ serverTimestamps: "estimate" }) })));
    if (firstSnapshot) {
      firstSnapshot = false;
      api(`/tickets/${encodeURIComponent(ticket.id)}/read`, { method: "POST", body: "{}" }).catch(() => {});
    }
  }, () => {
    const container = $("#ticket-messages");
    if (container && state.activeTicketId === ticket.id) container.textContent = "Não foi possível atualizar as mensagens agora.";
  });
}

async function sendTicketMessage(ticketId, form) {
  if (state.messageSending) return;
  const input = $("#ticket-message-text");
  const button = form?.querySelector("button[type=submit]");
  const text = input?.value?.trim() || "";
  if (!text) { notify("Escreva uma mensagem antes de enviar.", "error"); return; }
  state.messageSending = true;
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Enviando..."; }
  try {
    await api(`/tickets/${encodeURIComponent(ticketId)}/messages`, { method: "POST", body: JSON.stringify({ text }) });
    if (input) input.value = "";
  } catch (error) {
    notify(error.message || "Não foi possível enviar a mensagem.", "error");
  } finally {
    state.messageSending = false;
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

async function openTicket(ticketId) {
  stopMessageListener();
  show($("#tickets-modal"));
  const modal = $("#tickets-modal .modal-box");
  modal.innerHTML = '<button class="close" data-close aria-label="Fechar">×</button><p class="empty">Carregando ticket...</p>';
  try {
    const result = await api(`/tickets/${encodeURIComponent(ticketId)}`);
    const ticket = result.ticket;
    const relatedOrder = state.orders.find(order => order.id === ticket.orderId);
    modal.innerHTML = `
      <button class="close" data-close aria-label="Fechar">×</button>
      <div class="ticket-view-head"><span class="ticket-status pending">${escapeHtml(ticketStatusLabel(ticket.status))}</span><p>TICKET #${escapeHtml(ticket.id.slice(-10).toUpperCase())}</p><h2>${escapeHtml(ticket.subject || "Atendimento")}</h2><span>Pedido #${escapeHtml(ticket.orderId.slice(0, 10).toUpperCase())}</span></div>
      <div class="order-summary"><div><small>STATUS DO TICKET</small><strong>${escapeHtml(ticketStatusLabel(ticket.status))}</strong></div><div><small>STATUS DO PEDIDO</small><strong>${escapeHtml(statusLabel(relatedOrder?.status))}</strong></div><div><small>CRIADO EM</small><strong>${escapeHtml(formatDateTime(ticket.createdAt))}</strong></div><div><small>ÚLTIMA ATUALIZAÇÃO</small><strong>${escapeHtml(formatDateTime(ticket.updatedAt))}</strong></div></div>
      <section class="ticket-chat discord-ticket-chat" aria-label="Conversa do ticket"><div class="ticket-chat-head"><div><strong># atendimento-do-pedido</strong><small>Canal privado entre cliente e atendimento</small></div><span class="ticket-chat-live">● ${state.isAdmin ? "Você está como atendimento" : "Atendimento disponível"}</span></div><div class="messages" id="ticket-messages"><p class="empty">Carregando mensagens...</p></div>${["OPEN", "IN_PROGRESS"].includes(ticket.status) ? `<form class="message-form" id="ticket-message-form"><label class="sr-only" for="ticket-message-text">Mensagem</label><textarea id="ticket-message-text" maxlength="2000" rows="3" placeholder="Escreva uma mensagem para ${state.isAdmin ? "o cliente" : "o atendimento"}..."></textarea><button class="button primary" type="submit">Enviar mensagem <span>↑</span></button></form><small class="message-limit">Canal privado · até 2.000 caracteres por mensagem.</small>` : `<div class="ticket-chat-locked">🔒 Este ticket foi fechado ou arquivado. O histórico continua disponível.</div>`}</section>
      <div class="ticket-history"><strong>Histórico</strong>${result.events?.length ? `<ol class="admin-timeline">${result.events.map(event => { const actor = result.actors?.[event.actorUid] || {}; return `<li><strong>${escapeHtml(event.reason || event.type || "ALTERAÇÃO")}</strong><span>${escapeHtml(actor.displayName || "Sistema/atendimento")} · ${escapeHtml(formatDateTime(event.createdAt))}</span></li>`; }).join("")}</ol>` : '<p>Histórico anterior indisponível.</p>'}</div>
      ${relatedOrder ? `<button class="button admin-secondary" data-ticket-order="${escapeHtml(relatedOrder.id)}">Ver pedido</button>` : ""}<button class="button primary" data-back-tickets>Voltar aos tickets</button>`;
    $("[data-back-tickets]")?.addEventListener("click", openOrders);
    $("[data-ticket-order]")?.addEventListener("click", () => openOrder(ticket.orderId));
    $("#ticket-message-form")?.addEventListener("submit", event => { event.preventDefault(); sendTicketMessage(ticket.id, event.currentTarget); });
    startMessageListener(ticket);
  } catch (error) {
    modal.innerHTML = `<button class="close" data-close aria-label="Fechar">×</button><p class="empty">${escapeHtml(error.message || "Não foi possível carregar o ticket.")}</p><button class="button primary" data-back-tickets>Voltar aos tickets</button>`;
    $("[data-back-tickets]")?.addEventListener("click", openOrders);
  }
}

function safeQrDataUrl(base64) {
  return typeof base64 === "string" && /^[A-Za-z0-9+/=]+$/.test(base64) && base64.length <= 500000
    ? `data:image/png;base64,${base64}`
    : "";
}

function renderPixPayment(order, payment, loadError = "") {
  if (payment?.status === "PENDING" && payment.expiresAt && new Date(payment.expiresAt).getTime() > Date.now()) {
    const qrUrl = safeQrDataUrl(payment.qrCodeBase64);
    return `<section class="pix-payment" aria-label="Pagamento por PIX">
      <div class="pix-payment-head"><span>PIX EXCLUSIVO</span><strong>${currencyFromCents(payment.amountCents)}</strong></div>
      <p class="pix-payment-intro">Use este QR Code ou o PIX Copia e Cola. Ele foi criado para este pedido pelo servidor.</p>
      <div class="pix-code">${qrUrl ? `<img class="pix-qr-image" src="${qrUrl}" alt="QR Code PIX do pedido" />` : ""}<div><small>PIX COPIA E COLA</small><code>${escapeHtml(payment.pixCopyPaste || "Código indisponível")}</code><button type="button" class="button admin-secondary" data-copy-pix>Copiar código</button></div></div>
      <p class="pix-expiry">Válido até ${escapeHtml(formatDateTime(payment.expiresAt))}.</p>
      <p class="pix-waiting">Aguardando confirmação segura do pagamento pelo Mercado Pago. Enviar comprovante ou clicar em qualquer botão não confirma o pagamento.</p>
      <button type="button" class="button admin-secondary" data-check-payment>Já paguei — conferir agora</button>
    </section>`;
  }
  const expired = payment?.status === "PENDING" ? "O PIX anterior expirou. " : "";
  return `<section class="pix-payment pix-payment-start"><div class="pix-payment-head"><span>PAGAMENTO PIX</span><strong>${currencyFromCents(order.totalCents)}</strong></div><p>${expired}Gere um PIX exclusivo com o total oficial deste pedido.</p>${loadError ? `<p class="pix-error">${escapeHtml(loadError)}</p>` : ""}<button class="button primary" type="button" data-create-pix>Gerar PIX seguro →</button></section>`;
}

function paymentConfirmedCard(order) {
  return `<div class="review-card payment-confirmed"><span>✓</span><div><strong>Pagamento confirmado</strong><p>O Mercado Pago confirmou o pagamento com segurança. Seu ticket foi aberto e já está disponível na área do cliente.</p><button class="button primary" type="button" data-open-confirmed-ticket>Ir para meu ticket →</button></div></div>`;
}

async function openConfirmedTicket(orderId) {
  try {
    const result = await api("/tickets");
    state.tickets = result.tickets || [];
    const ticket = state.tickets.find(item => item.orderId === orderId);
    if (!ticket) {
      notify("O pagamento foi confirmado. O ticket está sendo preparado; tente novamente em alguns segundos.", "info");
      return;
    }
    await openTicket(ticket.id);
  } catch (error) {
    notify(error.message || "Não foi possível abrir seu ticket agora.", "error");
  }
}

function bindPixActions(order, payment) {
  $("[data-copy-pix]")?.addEventListener("click", async button => {
    try {
      await navigator.clipboard.writeText(payment.pixCopyPaste);
      button.currentTarget.textContent = "Código copiado ✓";
      setTimeout(() => { if (button.currentTarget) button.currentTarget.textContent = "Copiar código"; }, 1800);
    } catch {
      notify("Não foi possível copiar automaticamente. Selecione o código e copie.", "error");
    }
  });
  $("[data-create-pix]")?.addEventListener("click", event => createPixForOrder(order, event.currentTarget));
  $("[data-check-payment]")?.addEventListener("click", event => checkPaymentNow(order, event.currentTarget));
}

async function checkPaymentNow(order, button) {
  if (button?.disabled) return;
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Conferindo pagamento..."; }
  try {
    const result = await api(`/orders/${encodeURIComponent(order.id)}/payment`);
    const latestOrder = result.order ? { ...order, ...result.order } : order;
    state.orders = state.orders.map(item => item.id === latestOrder.id ? latestOrder : item);
    await renderOrderModal(latestOrder, result.payment || null);
    if (result.confirmed || latestOrder.paymentStatus === "PAID") {
      stopPaymentPolling();
      notify("Pagamento confirmado. Seu ticket foi aberto automaticamente.", "success");
    } else {
      notify("O Mercado Pago ainda não confirmou este pagamento. Aguarde um instante e tente novamente.", "info");
      startPaymentPolling(latestOrder.id);
    }
  } catch (error) {
    notify(error.message || "Não foi possível conferir o pagamento agora.", "error");
  } finally {
    if (button && document.body.contains(button)) { button.disabled = false; button.textContent = original || "Já paguei — conferir agora"; }
  }
}

function stopPaymentPolling() {
  if (paymentPollTimer) window.clearTimeout(paymentPollTimer);
  paymentPollTimer = null;
  paymentPollOrderId = null;
  paymentPollBusy = false;
}

function startPaymentPolling(orderId) {
  stopPaymentPolling();
  paymentPollOrderId = orderId;
  const checkAgain = async () => {
    if (paymentPollBusy || paymentPollOrderId !== orderId || !$("#tickets-modal")?.classList.contains("is-open")) return stopPaymentPolling();
    paymentPollBusy = true;
    try {
      const result = await api(`/orders/${encodeURIComponent(orderId)}/payment`);
      const currentOrder = state.orders.find(item => item.id === orderId);
      const latestOrder = result.order ? { ...(currentOrder || {}), ...result.order } : currentOrder;
      if (!latestOrder) return stopPaymentPolling();
      state.orders = state.orders.map(item => item.id === orderId ? latestOrder : item);
      await renderOrderModal(latestOrder, result.payment || null);
      if (result.confirmed || latestOrder.paymentStatus === "PAID") {
        stopPaymentPolling();
        notify("Pagamento confirmado. Seu ticket foi aberto automaticamente.", "success");
        return;
      }
    } catch {
      // A próxima tentativa continua disponível; não interrompe a compra por uma falha temporária.
    } finally {
      paymentPollBusy = false;
    }
    if (paymentPollOrderId === orderId) paymentPollTimer = window.setTimeout(checkAgain, 8000);
  };
  paymentPollTimer = window.setTimeout(checkAgain, 8000);
}

async function renderOrderModal(order, payment = null, loadError = "") {
  const modal = $("#tickets-modal .modal-box");
  modal.innerHTML = `
    <button class="close" data-close aria-label="Fechar">×</button>
    <div class="ticket-view-head">
      <span class="ticket-status pending">${escapeHtml(statusLabel(order.status))}</span>
      <p>PEDIDO #${escapeHtml(order.id.slice(0, 10).toUpperCase())}</p>
      <h2>${escapeHtml(orderProduct(order))}</h2>
      <span>Conta: ${escapeHtml(state.user?.email || "")}</span>
    </div>
    <div class="order-summary">
      <div><small>SUBTOTAL</small><strong>${currencyFromCents(order.subtotalCents)}</strong></div>
      <div><small>DESCONTO</small><strong>− ${currencyFromCents(order.discountCents)}</strong></div>
      <div><small>TOTAL OFICIAL</small><strong>${currencyFromCents(order.totalCents)}</strong></div>
      <div><small>PAGAMENTO</small><strong>${escapeHtml(order.paymentStatus || "UNPAID")}</strong></div>
    </div>
    ${order.status === "AWAITING_PAYMENT" && order.paymentStatus === "UNPAID" ? renderPixPayment(order, payment, loadError) : order.paymentStatus === "PAID" ? paymentConfirmedCard(order) : `<div class="review-card"><span>✓</span><div><strong>Pedido registrado</strong><p>O preço foi conferido no servidor. O status do pagamento é atualizado apenas pelo servidor.</p></div></div>`}
    ${order.status === "AWAITING_PAYMENT" && order.paymentStatus === "UNPAID" ? `<button class="button cancel-order" data-cancel-order="${escapeHtml(order.id)}">Cancelar pedido</button>` : ""}
    <button class="button primary" data-back-orders>Voltar aos pedidos</button>`;
  $("[data-back-orders]")?.addEventListener("click", openOrders);
  $("[data-open-confirmed-ticket]")?.addEventListener("click", () => openConfirmedTicket(order.id));
  $("[data-cancel-order]")?.addEventListener("click", event => cancelOrder(order.id, event.currentTarget));
  bindPixActions(order, payment);
}

async function openOrder(orderId) {
  stopPaymentPolling();
  const order = state.orders.find(item => item.id === orderId);
  if (!order) return;
  await renderOrderModal(order);
  if (order.status !== "AWAITING_PAYMENT" || order.paymentStatus !== "UNPAID") return;
  try {
    const result = await api(`/orders/${encodeURIComponent(order.id)}/payment`);
    const latestOrder = result.order ? { ...order, ...result.order } : order;
    state.orders = state.orders.map(item => item.id === latestOrder.id ? latestOrder : item);
    await renderOrderModal(latestOrder, result.payment || null);
    if (result.confirmed || latestOrder.paymentStatus === "PAID") notify("Pagamento confirmado. Seu ticket foi aberto automaticamente.", "success");
    else if (latestOrder.status === "AWAITING_PAYMENT" && latestOrder.paymentStatus === "UNPAID") startPaymentPolling(latestOrder.id);
  } catch (error) {
    await renderOrderModal(order, null, error.message || "Não foi possível consultar o PIX deste pedido.");
  }
}

async function createPixForOrder(order, button) {
  if (button?.disabled) return;
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Gerando PIX..."; }
  try {
    const result = await api(`/orders/${encodeURIComponent(order.id)}/pix`, { method: "POST", body: "{}" });
    await renderOrderModal(order, result.payment || null);
  } catch (error) {
    await renderOrderModal(order, null, error.message || "Não foi possível gerar o PIX.");
  } finally {
    if (button && document.body.contains(button)) { button.disabled = false; button.textContent = original || "Gerar PIX seguro →"; }
  }
}

function renderReviews() {
  const modal = $("#reviews-modal .modal-box");
  modal.innerHTML = `
    <button class="close" data-close aria-label="Fechar">×</button>
    <p class="eyebrow"><i></i> AVALIAÇÕES</p>
    <h2>Avaliações de clientes.</h2>
    <div class="empty-info"><span>★</span><strong>Somente compradores confirmados</strong><p>A avaliação será liberada pelo servidor apenas após o pedido ficar concluído.</p><button class="button primary" data-open-products>Ver produtos <span>→</span></button></div>`;
}

function nextAdminAction(order) {
  if (order.paymentStatus !== "PAID") return null;
  return ({
    PAYMENT_CONFIRMED: { route: "/admin/openTicket", label: "Abrir ticket" },
    TICKET_OPEN: { route: "/admin/startService", label: "Iniciar serviço" },
    IN_PROGRESS: { route: "/admin/completeService", label: "Concluir serviço" },
  })[order.status] || null;
}

function adminTicketForOrder(orderId) {
  return state.adminTickets.find(ticket => ticket.orderId === orderId) || null;
}

function ensureAdminPanelUi() {
  const list = $("#admin-orders-list");
  if (!list || $("#admin-summary")) return;
  list.insertAdjacentHTML("beforebegin", `
    <p class="admin-payment-note">Pagamentos são confirmados apenas pelo webhook seguro do Mercado Pago. Quando aprovado, o ticket é aberto automaticamente.</p>
    <div class="admin-tabs" role="tablist"><button class="admin-tab is-active" type="button" data-admin-view="orders">Pedidos</button><button class="admin-tab" type="button" data-admin-view="tickets">Tickets</button><button class="admin-tab" type="button" data-admin-view="audit">Auditoria</button></div>
    <div class="admin-summary" id="admin-summary" aria-live="polite"></div>
    <div class="admin-toolbar">
      <label><span>Buscar</span><input id="admin-order-search" type="search" placeholder="ID, nome, e-mail ou produto" autocomplete="off" /></label>
      <label><span>Status</span><select id="admin-status-filter"><option value="ALL">Todos os status</option></select></label>
    </div>
    <section id="admin-audit-panel" class="admin-audit-panel" hidden>
      <div class="admin-toolbar"><label><span>Buscar logs</span><input id="admin-audit-search" type="search" placeholder="Pedido, administrador ou ação" autocomplete="off" /></label><label><span>Categoria</span><select id="admin-audit-category"><option value="ALL">Todas</option><option value="ORDERS">Pedidos</option><option value="TICKETS">Tickets</option><option value="STATUS">Status</option><option value="PAYMENTS">Pagamentos</option><option value="SECURITY">Segurança</option></select></label><label><span>Período</span><select id="admin-audit-period"><option value="ALL">Todos</option><option value="TODAY">Hoje</option><option value="7D">Últimos 7 dias</option><option value="30D">Últimos 30 dias</option></select></label></div>
      <div id="admin-audit-list"><p class="empty">A auditoria será carregada ao abrir esta aba.</p></div>
      <button class="button admin-secondary" id="admin-audit-more" type="button" hidden>Carregar mais</button>
    </section>
    <section id="admin-ticket-panel" class="admin-ticket-panel" hidden>
      <div class="admin-toolbar"><label><span>Buscar tickets</span><input id="admin-ticket-search" type="search" placeholder="Ticket, pedido, cliente ou produto" autocomplete="off" /></label><label><span>Status</span><select id="admin-ticket-status"><option value="ALL">Todos os status</option><option value="OPEN">Abertos</option><option value="IN_PROGRESS">Em atendimento</option><option value="CLOSED">Fechados</option><option value="ARCHIVED">Arquivados</option></select></label></div>
      <button class="button admin-secondary" id="admin-reset-tickets" type="button">Apagar todos os tickets</button>
      <div id="admin-ticket-list"><p class="empty">Os tickets serão carregados ao abrir esta aba.</p></div>
      <button class="button admin-secondary" id="admin-ticket-more" type="button" hidden>Carregar mais</button>
    </section>`);
}

function renderAdminOrders() {
  const list = $("#admin-orders-list");
  if (!list) return;
  const query = state.adminSearch.trim().toLocaleLowerCase("pt-BR");
  const orders = state.adminOrders.filter(order => {
    const customer = state.adminCustomers[order.userId] || {};
    const searchable = [order.id, orderProduct(order), customer.displayName, customer.email].join(" ").toLocaleLowerCase("pt-BR");
    return (state.adminStatus === "ALL" || order.status === state.adminStatus) && (!query || searchable.includes(query));
  });
  renderAdminSummary(orders);
  if (!orders.length) {
    list.innerHTML = '<p class="empty">Nenhum pedido encontrado para este filtro.</p>';
    return;
  }
  list.innerHTML = orders.map(order => {
    const customer = state.adminCustomers[order.userId] || {};
    const action = nextAdminAction(order);
    const ticket = adminTicketForOrder(order.id);
    const ticketAllowed = !["CANCELLED", "PAYMENT_EXPIRED", "REFUNDED"].includes(order.status);
    const events = state.adminEvents[order.id];
    const isSelected = state.adminSelectedOrderId === order.id;
    return `<article class="admin-order">
      <div><span class="ticket-status pending">${escapeHtml(statusLabel(order.status))}</span><h3>#${escapeHtml(order.id.slice(0, 10).toUpperCase())} · ${escapeHtml(orderProduct(order))}</h3>
      <p>${escapeHtml(customer.displayName || "Cliente")} · ${escapeHtml(customer.email || order.userId)}</p>
      <small>Total ${currencyFromCents(order.totalCents)} · Pagamento ${escapeHtml(order.paymentStatus || "UNPAID")} · Criado em ${escapeHtml(formatDateTime(order.createdAt))}</small>
      ${isSelected ? `<div class="admin-detail"><strong>Histórico do pedido</strong>${events === undefined ? '<p>Carregando histórico...</p>' : events.length ? `<ol class="admin-timeline">${events.map(event => { const actor = state.adminEventActors[event.actorUid] || {}; return `<li><strong>${escapeHtml(statusLabel(event.to))}</strong><span>${escapeHtml(event.reason || event.type || "ALTERAÇÃO")} · ${escapeHtml(actor.displayName || "Sistema/usuário")} · ${escapeHtml(formatDateTime(event.createdAt))}</span></li>`; }).join("")}</ol>` : '<p>Histórico anterior indisponível.</p>'}</div>` : ""}</div>
      <div class="admin-actions"><button class="button admin-secondary" data-admin-detail="${escapeHtml(order.id)}">${isSelected ? "Ocultar detalhes" : "Ver detalhes"}</button><button class="button admin-secondary" data-copy-order="${escapeHtml(order.id)}">Copiar ID</button>${ticket ? `<button class="button admin-secondary" data-admin-ticket="${escapeHtml(ticket.id)}">Ver ticket</button>` : ticketAllowed ? `<button class="button admin-secondary" data-create-ticket="${escapeHtml(order.id)}">Abrir ticket</button>` : ""}${action ? `<button class="button primary" data-admin-action="${escapeHtml(action.route)}" data-admin-order="${escapeHtml(order.id)}">${escapeHtml(action.label)}</button>` : '<span class="admin-locked">Aguardando confirmação financeira confiável</span>'}</div>
    </article>`;
  }).join("");
  document.querySelectorAll("[data-admin-action]").forEach(button => button.addEventListener("click", () => runAdminAction(button.dataset.adminOrder, button.dataset.adminAction, button)));
  document.querySelectorAll("[data-admin-detail]").forEach(button => button.addEventListener("click", () => toggleAdminDetail(button.dataset.adminDetail)));
  document.querySelectorAll("[data-copy-order]").forEach(button => button.addEventListener("click", () => copyOrderId(button.dataset.copyOrder)));
  document.querySelectorAll("[data-create-ticket]").forEach(button => button.addEventListener("click", () => createAdminTicket(button.dataset.createTicket, button)));
  document.querySelectorAll("[data-admin-ticket]").forEach(button => button.addEventListener("click", () => openAdminTicketDetail(button.dataset.adminTicket)));
}

function renderAdminSummary(orders) {
  const summary = $("#admin-summary");
  if (!summary) return;
  const active = orders.filter(order => !["CANCELLED", "COMPLETED", "PAYMENT_EXPIRED", "REFUNDED"].includes(order.status)).length;
  const awaiting = orders.filter(order => order.status === "AWAITING_PAYMENT").length;
  const progressing = orders.filter(order => order.status === "IN_PROGRESS").length;
  summary.innerHTML = `<div><small>EXIBINDO</small><strong>${orders.length}</strong></div><div><small>EM ABERTO</small><strong>${active}</strong></div><div><small>AGUARDANDO PAGAMENTO</small><strong>${awaiting}</strong></div><div><small>EM ANDAMENTO</small><strong>${progressing}</strong></div>`;
}

function ticketAction(ticket) {
  return ({
    OPEN: { route: "/admin/ticket/start", label: "Iniciar atendimento" },
    IN_PROGRESS: { route: "/admin/ticket/close", label: "Fechar ticket" },
    CLOSED: { route: "/admin/ticket/reopen", label: "Reabrir ticket" },
  })[ticket.status] || null;
}

function renderAdminTickets() {
  const list = $("#admin-ticket-list");
  const more = $("#admin-ticket-more");
  if (!list) return;
  const query = state.adminTicketSearch.trim().toLocaleLowerCase("pt-BR");
  const tickets = state.adminTickets.filter(ticket => {
    const owner = state.adminTicketActors[ticket.ownerId] || {};
    const admin = state.adminTicketActors[ticket.assignedAdminUid] || {};
    const searchable = [ticket.id, ticket.orderId, ticket.productSummary, owner.displayName, owner.email, admin.displayName].join(" ").toLocaleLowerCase("pt-BR");
    return (state.adminTicketStatus === "ALL" || ticket.status === state.adminTicketStatus) && (!query || searchable.includes(query));
  });
  if (!tickets.length) list.innerHTML = '<p class="empty">Nenhum ticket encontrado.</p>';
  else list.innerHTML = tickets.map(ticket => {
    const owner = state.adminTicketActors[ticket.ownerId] || {};
    const admin = state.adminTicketActors[ticket.assignedAdminUid] || {};
    const action = ticketAction(ticket);
    const selected = state.adminSelectedTicketId === ticket.id;
    return `<article class="admin-order admin-ticket"><div><span class="ticket-status pending">${escapeHtml(ticketStatusLabel(ticket.status))}</span><h3>#${escapeHtml(ticket.id.slice(-10).toUpperCase())} · ${escapeHtml(ticket.productSummary || "Atendimento")}${Number(ticket.adminUnreadCount || 0) ? ` <b class="ticket-unread">${Number(ticket.adminUnreadCount || 0)} nova${Number(ticket.adminUnreadCount || 0) === 1 ? "" : "s"}</b>` : ""}</h3><p>${escapeHtml(ticket.lastMessagePreview || `${owner.displayName || "Cliente"} · ${owner.email || ticket.ownerId}`)}</p><small>Pedido #${escapeHtml(ticket.orderId.slice(0, 10).toUpperCase())} · ${ticket.lastMessageAt ? `Última mensagem em ${escapeHtml(formatDateTime(ticket.lastMessageAt))}` : `Atualizado em ${escapeHtml(formatDateTime(ticket.updatedAt))}`}${admin.displayName ? ` · Responsável: ${escapeHtml(admin.displayName)}` : " · Sem responsável"}</small>${selected ? `<div class="admin-detail" id="admin-ticket-detail-${escapeHtml(ticket.id)}"><p>Carregando detalhes...</p></div>` : ""}</div><div class="admin-actions"><button class="button admin-secondary" data-ticket-detail="${escapeHtml(ticket.id)}">${selected ? "Ocultar detalhes" : "Ver ticket"}</button>${!ticket.assignedAdminUid && ticket.status !== "ARCHIVED" ? `<button class="button admin-secondary" data-ticket-assign="${escapeHtml(ticket.id)}">Assumir</button>` : ""}${action ? `<button class="button primary" data-ticket-action="${escapeHtml(action.route)}" data-ticket-id="${escapeHtml(ticket.id)}">${escapeHtml(action.label)}</button>` : ""}${ticket.status === "CLOSED" ? `<button class="button admin-secondary" data-ticket-action="/admin/ticket/archive" data-ticket-id="${escapeHtml(ticket.id)}">Arquivar</button>` : ""}</div></article>`;
  }).join("");
  document.querySelectorAll("[data-ticket-detail]").forEach(button => button.addEventListener("click", () => openAdminTicketDetail(button.dataset.ticketDetail)));
  document.querySelectorAll("[data-ticket-assign]").forEach(button => button.addEventListener("click", () => runTicketAction(button.dataset.ticketAssign, "/admin/ticket/assignSelf", button)));
  document.querySelectorAll("[data-ticket-action]").forEach(button => button.addEventListener("click", () => runTicketAction(button.dataset.ticketId, button.dataset.ticketAction, button)));
  if (more) more.hidden = !state.adminTicketNextPageToken;
}

async function loadAdminTickets(reset = true) {
  if (!state.isAdmin || (!reset && !state.adminTicketNextPageToken)) return;
  const list = $("#admin-ticket-list");
  if (reset && list) list.innerHTML = '<p class="empty">Carregando tickets...</p>';
  try {
    const params = new URLSearchParams({ pageSize: "25" });
    if (!reset && state.adminTicketNextPageToken) params.set("pageToken", state.adminTicketNextPageToken);
    const result = await api(`/admin/tickets?${params.toString()}`);
    state.adminTickets = reset ? (result.tickets || []) : [...state.adminTickets, ...(result.tickets || [])];
    state.adminTicketActors = { ...state.adminTicketActors, ...(result.actors || {}) };
    state.adminTicketNextPageToken = result.nextPageToken || null;
  } catch (error) {
    if (list) list.innerHTML = `<p class="empty">${escapeHtml(error.message || "Não foi possível carregar os tickets.")}</p>`;
  }
  renderAdminTickets();
}

function bindAdminControls() {
  const search = $("#admin-order-search");
  const filter = $("#admin-status-filter");
  if (search && !search.dataset.bound) {
    search.dataset.bound = "true";
    search.addEventListener("input", () => { state.adminSearch = search.value; renderAdminOrders(); });
  }
  if (filter && !filter.dataset.bound) {
    filter.dataset.bound = "true";
    filter.addEventListener("change", () => { state.adminStatus = filter.value; renderAdminOrders(); });
  }
  if (filter) {
    const statuses = [...new Set(state.adminOrders.map(order => order.status).filter(Boolean))].sort();
    filter.innerHTML = `<option value="ALL">Todos os status</option>${statuses.map(status => `<option value="${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</option>`).join("")}`;
    filter.value = statuses.includes(state.adminStatus) ? state.adminStatus : "ALL";
  }
  if (search) search.value = state.adminSearch;
  document.querySelectorAll("[data-admin-view]").forEach(button => button.onclick = () => switchAdminView(button.dataset.adminView));
  const auditSearch = $("#admin-audit-search");
  const auditCategory = $("#admin-audit-category");
  const auditPeriod = $("#admin-audit-period");
  if (auditSearch && !auditSearch.dataset.bound) {
    auditSearch.dataset.bound = "true";
    auditSearch.addEventListener("input", () => { state.auditSearch = auditSearch.value; renderAuditLogs(); });
  }
  if (auditCategory && !auditCategory.dataset.bound) {
    auditCategory.dataset.bound = "true";
    auditCategory.addEventListener("change", () => { state.auditCategory = auditCategory.value; renderAuditLogs(); });
  }
  if (auditPeriod && !auditPeriod.dataset.bound) {
    auditPeriod.dataset.bound = "true";
    auditPeriod.addEventListener("change", () => { state.auditPeriod = auditPeriod.value; renderAuditLogs(); });
  }
  if (auditSearch) auditSearch.value = state.auditSearch;
  if (auditCategory) auditCategory.value = state.auditCategory;
  if (auditPeriod) auditPeriod.value = state.auditPeriod;
  $("#admin-audit-more")?.addEventListener("click", () => loadAuditLogs(false));
  const ticketSearch = $("#admin-ticket-search");
  const ticketStatus = $("#admin-ticket-status");
  if (ticketSearch && !ticketSearch.dataset.bound) {
    ticketSearch.dataset.bound = "true";
    ticketSearch.addEventListener("input", () => { state.adminTicketSearch = ticketSearch.value; renderAdminTickets(); });
  }
  if (ticketStatus && !ticketStatus.dataset.bound) {
    ticketStatus.dataset.bound = "true";
    ticketStatus.addEventListener("change", () => { state.adminTicketStatus = ticketStatus.value; renderAdminTickets(); });
  }
  if (ticketSearch) ticketSearch.value = state.adminTicketSearch;
  if (ticketStatus) ticketStatus.value = state.adminTicketStatus;
  $("#admin-ticket-more")?.addEventListener("click", () => loadAdminTickets(false));
  const resetTicketsButton = $("#admin-reset-tickets");
  if (resetTicketsButton && !resetTicketsButton.dataset.bound) {
    resetTicketsButton.dataset.bound = "true";
    resetTicketsButton.addEventListener("click", resetAllTickets);
  }
}

async function resetAllTickets(event) {
  if (!state.isAdmin || !window.confirm("Apagar TODOS os tickets e mensagens? Pedidos e pagamentos não serão alterados.")) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await api("/admin/resetTickets", { method: "POST", body: JSON.stringify({ confirmation: "DELETE_ALL_TICKETS" }) });
    state.adminTickets = [];
    state.adminTicketActors = {};
    state.adminTicketNextPageToken = null;
    renderAdminTickets();
    notify(`${result.removedTickets || 0} ticket(s) apagado(s).`, "success");
  } catch (error) {
    notify(error.message || "Não foi possível apagar os tickets.", "error");
  } finally {
    button.disabled = false;
  }
}

function auditLabel(log) {
  return log.reason || log.type || log.action || "AÇÃO REGISTRADA";
}

function auditMatchesPeriod(log) {
  if (state.auditPeriod === "ALL" || !log.createdAt) return true;
  const date = new Date(log.createdAt);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const days = state.auditPeriod === "TODAY" ? 1 : Number(state.auditPeriod.replace("D", ""));
  return date.getTime() >= now.getTime() - days * 24 * 60 * 60 * 1000;
}

function renderAuditLogs() {
  const list = $("#admin-audit-list");
  const more = $("#admin-audit-more");
  if (!list) return;
  const query = state.auditSearch.trim().toLocaleLowerCase("pt-BR");
  const logs = state.auditLogs.filter(log => {
    const actor = state.auditActors[log.actorUid || log.userId] || {};
    const searchable = [log.orderId, auditLabel(log), actor.displayName, actor.email, log.category].join(" ").toLocaleLowerCase("pt-BR");
    return (state.auditCategory === "ALL" || log.category === state.auditCategory) && auditMatchesPeriod(log) && (!query || searchable.includes(query));
  });
  list.innerHTML = logs.length ? `<div class="audit-list">${logs.map(log => {
    const actor = state.auditActors[log.actorUid || log.userId] || {};
    const change = log.from || log.to ? `${statusLabel(log.from) || "—"} → ${statusLabel(log.to) || "—"}` : "Registro criado";
    return `<article class="audit-row"><div><span class="audit-category">${escapeHtml(log.category || "ORDERS")}</span><strong>${escapeHtml(auditLabel(log))}</strong><p>${escapeHtml(change)} · Pedido ${escapeHtml(log.orderId ? `#${log.orderId.slice(0, 10).toUpperCase()}` : "não associado")}</p><small>${escapeHtml(actor.displayName || "Sistema/usuário")} ${actor.email ? `· ${escapeHtml(actor.email)}` : ""}</small></div><time>${escapeHtml(formatDateTime(log.createdAt))}</time></article>`;
  }).join("")}</div>` : '<p class="empty">Nenhum registro encontrado.</p>';
  if (more) more.hidden = !state.auditNextPageToken || state.auditLoading;
}

async function loadAuditLogs(reset = true) {
  if (state.auditLoading || (!reset && !state.auditNextPageToken)) return;
  state.auditLoading = true;
  const list = $("#admin-audit-list");
  if (reset && list) list.innerHTML = '<p class="empty">Carregando auditoria...</p>';
  try {
    const params = new URLSearchParams({ pageSize: "25" });
    if (!reset && state.auditNextPageToken) params.set("pageToken", state.auditNextPageToken);
    const result = await api(`/admin/audit?${params.toString()}`);
    state.auditLogs = reset ? (result.logs || []) : [...state.auditLogs, ...(result.logs || [])];
    state.auditActors = { ...state.auditActors, ...(result.actors || {}) };
    state.auditNextPageToken = result.nextPageToken || null;
  } catch (error) {
    if (list) list.innerHTML = `<p class="empty">${escapeHtml(error.message || "Não foi possível carregar a auditoria.")}</p>`;
  } finally {
    state.auditLoading = false;
    renderAuditLogs();
  }
}

async function switchAdminView(view) {
  if (!state.isAdmin || !["orders", "tickets", "audit"].includes(view)) return;
  state.adminView = view;
  const auditPanel = $("#admin-audit-panel");
  const ticketPanel = $("#admin-ticket-panel");
  const list = $("#admin-orders-list");
  document.querySelectorAll("[data-admin-view]").forEach(button => button.classList.toggle("is-active", button.dataset.adminView === view));
  if (list) list.hidden = view !== "orders";
  $("#admin-summary")?.toggleAttribute("hidden", view !== "orders");
  $("#admin-order-search")?.closest(".admin-toolbar")?.toggleAttribute("hidden", view !== "orders");
  if (auditPanel) auditPanel.hidden = view !== "audit";
  if (ticketPanel) ticketPanel.hidden = view !== "tickets";
  if (view === "audit" && !state.auditLogs.length) await loadAuditLogs(true);
  if (view === "tickets" && !state.adminTickets.length) await loadAdminTickets(true);
}

async function toggleAdminDetail(orderId) {
  if (state.adminSelectedOrderId === orderId) {
    state.adminSelectedOrderId = null;
    renderAdminOrders();
    return;
  }
  state.adminSelectedOrderId = orderId;
  renderAdminOrders();
  if (state.adminEvents[orderId] !== undefined) return;
  try {
    const result = await api(`/admin/orderEvents?orderId=${encodeURIComponent(orderId)}`);
    state.adminEvents[orderId] = result.events || [];
    state.adminEventActors = { ...state.adminEventActors, ...(result.actors || {}) };
  } catch (error) {
    state.adminEvents[orderId] = [];
    notify(error.message || "Não foi possível carregar o histórico.", "error");
  }
  if (state.adminSelectedOrderId === orderId) renderAdminOrders();
}

async function copyOrderId(orderId) {
  try {
    await navigator.clipboard.writeText(orderId);
    notify("ID do pedido copiado.", "success");
  } catch {
    notify(`ID do pedido: ${orderId}`, "info");
  }
}

async function createAdminTicket(orderId, button) {
  if (state.adminActionInFlight) return;
  if (!window.confirm("Abrir um ticket de atendimento para este pedido? A ação ficará registrada.")) return;
  state.adminActionInFlight = true;
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Criando ticket..."; }
  try {
    const result = await api("/admin/createTicket", { method: "POST", body: JSON.stringify({ orderId }) });
    notify(result.alreadyApplied ? "Este pedido já possuía um ticket." : "Ticket criado e registrado na auditoria.", "success");
    await loadAdminTickets(true);
    renderAdminOrders();
    await switchAdminView("tickets");
  } catch (error) {
    notify(error.message || "Não foi possível criar o ticket.", "error");
  } finally {
    state.adminActionInFlight = false;
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

async function openAdminTicketDetail(ticketId) {
  if (state.adminSelectedTicketId === ticketId) {
    state.adminSelectedTicketId = null;
    renderAdminTickets();
    return;
  }
  state.adminSelectedTicketId = ticketId;
  renderAdminTickets();
  const detail = $(`#admin-ticket-detail-${ticketId}`);
  try {
    const result = await api(`/tickets/${encodeURIComponent(ticketId)}`);
    const ticket = result.ticket;
    const assigned = result.actors?.[ticket.assignedAdminUid] || {};
    if (detail) {
      detail.innerHTML = `<strong>Detalhes do ticket</strong><p>Pedido #${escapeHtml(ticket.orderId.slice(0, 10).toUpperCase())} · ${escapeHtml(ticket.subject || "Atendimento")}</p><p>Responsável: ${escapeHtml(assigned.displayName || "Sem responsável")}</p><button class="button admin-secondary" data-admin-open-conversation="${escapeHtml(ticket.id)}">Abrir conversa</button><strong>Histórico</strong>${result.events?.length ? `<ol class="admin-timeline">${result.events.map(event => { const actor = result.actors?.[event.actorUid] || {}; return `<li><strong>${escapeHtml(event.reason || event.type)}</strong><span>${escapeHtml(actor.displayName || "Sistema/atendimento")} · ${escapeHtml(formatDateTime(event.createdAt))}</span></li>`; }).join("")}</ol>` : "<p>Histórico anterior indisponível.</p>"}`;
      detail.querySelector("[data-admin-open-conversation]")?.addEventListener("click", () => { hideAll(); openTicket(ticket.id); });
    }
  } catch (error) {
    if (detail) detail.innerHTML = `<p>${escapeHtml(error.message || "Não foi possível carregar os detalhes.")}</p>`;
  }
}

async function runTicketAction(ticketId, route, button) {
  const labels = { "/admin/ticket/assignSelf": "assumir este ticket", "/admin/ticket/start": "iniciar o atendimento", "/admin/ticket/close": "fechar este ticket", "/admin/ticket/reopen": "reabrir este ticket", "/admin/ticket/archive": "arquivar este ticket" };
  if (!labels[route] || state.adminActionInFlight) return;
  if (!window.confirm(`Confirmar ação: ${labels[route]}? Esta alteração será registrada no histórico.`)) return;
  state.adminActionInFlight = true;
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Atualizando..."; }
  try {
    const result = await api(route, { method: "POST", body: JSON.stringify({ ticketId }) });
    notify(result.alreadyApplied ? "A ação já havia sido aplicada." : "Ticket atualizado com segurança.", "success");
    await loadAdminTickets(true);
  } catch (error) {
    notify(error.message || "Não foi possível atualizar o ticket.", "error");
  } finally {
    state.adminActionInFlight = false;
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

async function openAdmin(initialView = "orders") {
  hideAll();
  show($("#admin-modal"));
  ensureAdminPanelUi();
  const list = $("#admin-orders-list");
  if (!state.isAdmin) {
    list.innerHTML = '<p class="empty">Acesso administrativo não autorizado.</p>';
    return;
  }
  list.innerHTML = '<p class="empty">Conferindo sua permissão no servidor...</p>';
  try {
    const [result, ticketResult] = await Promise.all([api("/admin/orders"), api("/admin/tickets?pageSize=25")]);
    state.adminOrders = result.orders || [];
    state.adminCustomers = result.customers || {};
    state.adminTickets = ticketResult.tickets || [];
    state.adminTicketActors = ticketResult.actors || {};
    state.adminTicketNextPageToken = ticketResult.nextPageToken || null;
    state.adminSelectedTicketId = null;
    state.adminEvents = {};
    state.adminEventActors = {};
    state.adminSelectedOrderId = null;
    state.adminView = "orders";
    state.auditLogs = [];
    state.auditActors = {};
    state.auditNextPageToken = null;
    bindAdminControls();
    renderAdminOrders();
    await switchAdminView(initialView === "tickets" ? "tickets" : "orders");
  } catch (error) {
    list.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

async function runAdminAction(orderId, route, button) {
  const allowedRoutes = new Set(["/admin/openTicket", "/admin/startService", "/admin/completeService"]);
  if (!allowedRoutes.has(route) || state.adminActionInFlight) return;
  const labels = { "/admin/openTicket": "abrir o ticket", "/admin/startService": "iniciar o serviço", "/admin/completeService": "marcar o serviço como concluído" };
  if (!window.confirm(`Confirmar ação: ${labels[route]}? Esta alteração será registrada no histórico.`)) return;
  state.adminActionInFlight = true;
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Salvando..."; }
  try {
    const result = await api(route, { method: "POST", body: JSON.stringify({ orderId }) });
    notify(result.alreadyApplied ? "A ação já havia sido aplicada." : "Ação concluída e registrada na auditoria.", "success");
    await openAdmin();
  } catch (error) {
    notify(error.message, "error");
  } finally {
    state.adminActionInFlight = false;
    if (button) { button.disabled = false; button.textContent = original; }
  }
}

async function cancelOrder(orderId, button) {
  if (state.cancelInFlight) return;
  if (!window.confirm("Cancelar este pedido? Se houver desconto reservado, ele será liberado.")) return;
  state.cancelInFlight = true;
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Cancelando..."; }
  try {
    const result = await api("/cancelOrder", { method: "POST", body: JSON.stringify({ orderId }) });
    notify(result.alreadyApplied ? "O pedido já estava cancelado." : "Pedido cancelado com segurança.", "success");
    await loadAccount();
    await openOrders();
  } catch (error) {
    notify(error.message, "error");
  } finally {
    state.cancelInFlight = false;
    if (button) { button.disabled = false; button.textContent = original; }
  }
}
const wonsQuantity = $("#wons-quantity");
const wonsPrice = $("#wons-price");
const rollQuantity = $("#roll-quantity");
const rollPrice = $("#roll-price");

function updateWonsPrice() {
  const item = product("farm_wons_1b");
  const quantity = Math.max(1, Math.floor(Number(wonsQuantity?.value) || 1));
  if (wonsPrice && item) wonsPrice.textContent = currencyFromCents(item.priceCents * quantity);
}

function updateRollPrice() {
  const item = product("power_roll");
  const quantity = Math.max(1, Math.floor(Number(rollQuantity?.value) || 1));
  if (rollPrice && item) rollPrice.textContent = currencyFromCents(item.priceCents * quantity);
}

wonsQuantity?.addEventListener("input", updateWonsPrice);
rollQuantity?.addEventListener("input", updateRollPrice);

$("[data-product='farm_melhorias']")?.addEventListener("click", async () => {
  if (await requireSignedIn()) await addItem("farm_melhorias", 1);
});
$("[data-wons]")?.addEventListener("click", async () => {
  if (await requireSignedIn()) await addItem("farm_wons_1b", wonsQuantity.value);
});
$("[data-power-roll]")?.addEventListener("click", async () => {
  if (await requireSignedIn()) await addItem("power_roll", rollQuantity.value);
});

$("#checkout-button")?.addEventListener("click", async () => {
  if (!(await requireSignedIn())) return;
  hideAll();
  renderCheckoutSummary();
  show($("#checkout-modal"));
});
$("#checkout-form")?.addEventListener("submit", submitOrders);
$("#profile-form")?.addEventListener("submit", saveProfile);
$("#support-ai-form")?.addEventListener("submit", sendSupportMessage);
document.querySelectorAll("[data-support-question]").forEach(button => button.addEventListener("click", () => askSupportQuestion(button.dataset.supportQuestion)));
$("#login-google")?.addEventListener("click", enterWithGoogle);
overlay?.addEventListener("click", hideAll);

document.addEventListener("click", async event => {
  const authButton = event.target.closest("[data-auth]");
  if (authButton) {
    event.preventDefault();
    state.user ? await signOut(auth) : openLoginModal();
    return;
  }
  const target = event.target.closest("[data-open-products],[data-open-cart],[data-open-tickets],[data-open-orders],[data-open-reviews],[data-open-faq],[data-open-admin],[data-open-profile],[data-close]");
  if (!target) return;
  event.preventDefault();
  if (target.matches("[data-close]")) {
    hideAll();
    return;
  }
  hideAll();
  if (target.matches("[data-open-products]")) show($("#produtos"));
  else if (target.matches("[data-open-cart]")) show(drawer);
  else if (target.matches("[data-open-tickets]")) {
    if (state.isAdmin) await openAdmin("tickets");
    else { state.customerView = "tickets"; await openOrders(); }
  }
  else if (target.matches("[data-open-orders]")) { state.customerView = "orders"; await openOrders(); }
  else if (target.matches("[data-open-reviews]")) { renderReviews(); show($("#reviews-modal")); }
  else if (target.matches("[data-open-faq]")) { renderSupportConversation(); show($("#faq-modal")); }
  else if (target.matches("[data-open-admin]")) await openAdmin();
  else if (target.matches("[data-open-profile]")) openProfile();
});

onAuthStateChanged(auth, async user => {
  state.user = user;
  state.account = null;
  state.isAdmin = false;
  if (user) {
    const tokenResult = await user.getIdTokenResult(true);
    state.isAdmin = tokenResult.claims.admin === true;
    await loadAccount();
  } else {
    state.orders = [];
    state.tickets = [];
    state.adminOrders = [];
    state.adminTickets = [];
    state.adminTicketActors = {};
    state.adminTicketNextPageToken = null;
    state.adminCustomers = {};
    state.adminEvents = {};
    state.adminEventActors = {};
    state.auditLogs = [];
    state.auditActors = {};
    state.auditNextPageToken = null;
    state.cart = [];
    state.checkoutAttemptId = null;
    updateAccountButton();
    updateProfileCard();
    renderCart();
  }
});

renderCart();
renderReviews();
loadProducts();

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
const googleProvider = new GoogleAuthProvider();
const $ = selector => document.querySelector(selector);
const state = { user: null, account: null, isAdmin: false, products: new Map(), discountConfig: { active: false }, cart: [], orders: [], adminOrders: [], adminCustomers: {}, adminEvents: {}, adminEventActors: {}, adminSearch: "", adminStatus: "ALL", adminSelectedOrderId: null, adminView: "orders", auditLogs: [], auditActors: {}, auditSearch: "", auditCategory: "ALL", auditPeriod: "ALL", auditNextPageToken: null, auditLoading: false, checkoutAttemptId: null, adminActionInFlight: false, cancelInFlight: false, submitting: false };
const overlay = $("#overlay");
const drawer = $("#cart-drawer");

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
  document.querySelectorAll(".drawer.is-open, .modal.is-open, .products.is-open, .overlay.is-open")
    .forEach(element => element.classList.remove("is-open"));
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
  } catch (error) {
    const message = error.code === "auth/unauthorized-domain"
      ? "O domínio do site ainda precisa ser autorizado no Firebase."
      : "Não foi possível entrar com o Google.";
    notify(message, "error");
  }
}

async function requireSignedIn() {
  if (state.user) return true;
  await enterWithGoogle();
  return Boolean(auth.currentUser);
}

function updateAccountButton() {
  const button = $("[data-auth]");
  document.querySelectorAll("[data-open-admin]").forEach(item => { item.hidden = !state.isAdmin; });
  if (!button) return;
  if (!state.user) {
    button.textContent = "Entrar com Google";
    button.classList.remove("admin");
    button.title = "";
    return;
  }
  const isAdmin = state.isAdmin;
  const firstName = state.user.displayName?.split(" ")[0] || "Minha conta";
  button.textContent = isAdmin ? "Admin · Sair" : `${firstName} · Sair`;
  button.classList.toggle("admin", isAdmin);
  button.title = state.user.email || "";
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
}

async function loadProducts() {
  try {
    const data = await api("/products", {}, false);
    state.products = new Map(data.products.map(product => [product.id, product]));
    state.discountConfig = data.discountConfig || { active: false };
    updateDisplayedPrices();
    renderCart();
  } catch (error) {
    notify("Não foi possível carregar os preços do servidor.", "error");
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

function addItem(productId, quantity) {
  const itemProduct = product(productId);
  if (!itemProduct) {
    notify("Aguarde os produtos terminarem de carregar.", "error");
    return;
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
  $("#cart-count").textContent = count;
  $("#side-cart-count").textContent = count;
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
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data não disponível" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function orderProduct(order) {
  return order.items?.length
    ? order.items.map(item => `${item.quantity} × ${item.name}`).join(" + ")
    : "Pedido";
}

function renderOrders() {
  const list = $("#tickets-list");
  if (!state.user) {
    list.innerHTML = '<div class="empty-info"><span>◌</span><strong>Entre para ver seus pedidos</strong><p>Seus pedidos ficam ligados à sua conta Google.</p><button class="button primary" data-login-orders>Entrar com Google <span>→</span></button></div>';
    $("[data-login-orders]")?.addEventListener("click", async () => {
      if (await requireSignedIn()) await openOrders();
    });
    return;
  }
  list.innerHTML = state.orders.length ? state.orders.map(order => `
    <article class="ticket ticket-new">
      <div class="ticket-orb">⌛</div>
      <div class="ticket-data">
        <span class="ticket-status pending">${escapeHtml(statusLabel(order.status))}</span>
        <h3>#${escapeHtml(order.id.slice(0, 10).toUpperCase())} · ${escapeHtml(orderProduct(order))}</h3>
        <p>Subtotal ${currencyFromCents(order.subtotalCents)} · Desconto ${currencyFromCents(order.discountCents)} · Total ${currencyFromCents(order.totalCents)}</p>
        <small>${escapeHtml(order.paymentStatus || "UNPAID")} · valores congelados no pedido</small>
      </div>
      <button data-order="${escapeHtml(order.id)}">Ver pedido →</button>
    </article>`).join("") : '<p class="empty">Você ainda não possui pedidos. Finalize sua compra para começar.</p>';
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
  list.innerHTML = '<p class="empty">Carregando seus pedidos...</p>';
  try {
    state.orders = (await api("/orders")).orders;
    renderOrders();
  } catch (error) {
    list.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

function openOrder(orderId) {
  const order = state.orders.find(item => item.id === orderId);
  if (!order) return;
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
    <div class="review-card"><span>✓</span><div><strong>Pedido registrado</strong><p>O preço foi conferido no servidor. O PIX automático será conectado na próxima etapa.</p></div></div>
    ${order.status === "AWAITING_PAYMENT" && order.paymentStatus === "UNPAID" ? `<button class="button cancel-order" data-cancel-order="${escapeHtml(order.id)}">Cancelar pedido</button>` : ""}
    <button class="button primary" data-back-orders>Voltar aos pedidos</button>`;
  $("[data-back-orders]")?.addEventListener("click", openOrders);
  $("[data-cancel-order]")?.addEventListener("click", event => cancelOrder(order.id, event.currentTarget));
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

function ensureAdminPanelUi() {
  const list = $("#admin-orders-list");
  if (!list || $("#admin-summary")) return;
  list.insertAdjacentHTML("beforebegin", `
    <p class="admin-payment-note">Pagamentos só serão confirmados automaticamente quando a integração PIX for ativada.</p>
    <div class="admin-tabs" role="tablist"><button class="admin-tab is-active" type="button" data-admin-view="orders">Pedidos</button><button class="admin-tab" type="button" data-admin-view="audit">Auditoria</button></div>
    <div class="admin-summary" id="admin-summary" aria-live="polite"></div>
    <div class="admin-toolbar">
      <label><span>Buscar</span><input id="admin-order-search" type="search" placeholder="ID, nome, e-mail ou produto" autocomplete="off" /></label>
      <label><span>Status</span><select id="admin-status-filter"><option value="ALL">Todos os status</option></select></label>
    </div>
    <section id="admin-audit-panel" class="admin-audit-panel" hidden>
      <div class="admin-toolbar"><label><span>Buscar logs</span><input id="admin-audit-search" type="search" placeholder="Pedido, administrador ou ação" autocomplete="off" /></label><label><span>Categoria</span><select id="admin-audit-category"><option value="ALL">Todas</option><option value="ORDERS">Pedidos</option><option value="STATUS">Status</option><option value="PAYMENTS">Pagamentos</option><option value="SECURITY">Segurança</option></select></label><label><span>Período</span><select id="admin-audit-period"><option value="ALL">Todos</option><option value="TODAY">Hoje</option><option value="7D">Últimos 7 dias</option><option value="30D">Últimos 30 dias</option></select></label></div>
      <div id="admin-audit-list"><p class="empty">A auditoria será carregada ao abrir esta aba.</p></div>
      <button class="button admin-secondary" id="admin-audit-more" type="button" hidden>Carregar mais</button>
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
    const events = state.adminEvents[order.id];
    const isSelected = state.adminSelectedOrderId === order.id;
    return `<article class="admin-order">
      <div><span class="ticket-status pending">${escapeHtml(statusLabel(order.status))}</span><h3>#${escapeHtml(order.id.slice(0, 10).toUpperCase())} · ${escapeHtml(orderProduct(order))}</h3>
      <p>${escapeHtml(customer.displayName || "Cliente")} · ${escapeHtml(customer.email || order.userId)}</p>
      <small>Total ${currencyFromCents(order.totalCents)} · Pagamento ${escapeHtml(order.paymentStatus || "UNPAID")} · Criado em ${escapeHtml(formatDateTime(order.createdAt))}</small>
      ${isSelected ? `<div class="admin-detail"><strong>Histórico do pedido</strong>${events === undefined ? '<p>Carregando histórico...</p>' : events.length ? `<ol class="admin-timeline">${events.map(event => { const actor = state.adminEventActors[event.actorUid] || {}; return `<li><strong>${escapeHtml(statusLabel(event.to))}</strong><span>${escapeHtml(event.reason || event.type || "ALTERAÇÃO")} · ${escapeHtml(actor.displayName || "Sistema/usuário")} · ${escapeHtml(formatDateTime(event.createdAt))}</span></li>`; }).join("")}</ol>` : '<p>Histórico anterior indisponível.</p>'}</div>` : ""}</div>
      <div class="admin-actions"><button class="button admin-secondary" data-admin-detail="${escapeHtml(order.id)}">${isSelected ? "Ocultar detalhes" : "Ver detalhes"}</button><button class="button admin-secondary" data-copy-order="${escapeHtml(order.id)}">Copiar ID</button>${action ? `<button class="button primary" data-admin-action="${escapeHtml(action.route)}" data-admin-order="${escapeHtml(order.id)}">${escapeHtml(action.label)}</button>` : '<span class="admin-locked">Aguardando confirmação financeira confiável</span>'}</div>
    </article>`;
  }).join("");
  document.querySelectorAll("[data-admin-action]").forEach(button => button.addEventListener("click", () => runAdminAction(button.dataset.adminOrder, button.dataset.adminAction, button)));
  document.querySelectorAll("[data-admin-detail]").forEach(button => button.addEventListener("click", () => toggleAdminDetail(button.dataset.adminDetail)));
  document.querySelectorAll("[data-copy-order]").forEach(button => button.addEventListener("click", () => copyOrderId(button.dataset.copyOrder)));
}

function renderAdminSummary(orders) {
  const summary = $("#admin-summary");
  if (!summary) return;
  const active = orders.filter(order => !["CANCELLED", "COMPLETED", "PAYMENT_EXPIRED", "REFUNDED"].includes(order.status)).length;
  const awaiting = orders.filter(order => order.status === "AWAITING_PAYMENT").length;
  const progressing = orders.filter(order => order.status === "IN_PROGRESS").length;
  summary.innerHTML = `<div><small>EXIBINDO</small><strong>${orders.length}</strong></div><div><small>EM ABERTO</small><strong>${active}</strong></div><div><small>AGUARDANDO PAGAMENTO</small><strong>${awaiting}</strong></div><div><small>EM ANDAMENTO</small><strong>${progressing}</strong></div>`;
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
  if (!state.isAdmin || !["orders", "audit"].includes(view)) return;
  state.adminView = view;
  const auditPanel = $("#admin-audit-panel");
  const list = $("#admin-orders-list");
  document.querySelectorAll("[data-admin-view]").forEach(button => button.classList.toggle("is-active", button.dataset.adminView === view));
  if (list) list.hidden = view !== "orders";
  $("#admin-summary")?.toggleAttribute("hidden", view !== "orders");
  $("#admin-order-search")?.closest(".admin-toolbar")?.toggleAttribute("hidden", view !== "orders");
  if (auditPanel) auditPanel.hidden = view !== "audit";
  if (view === "audit" && !state.auditLogs.length) await loadAuditLogs(true);
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

async function openAdmin() {
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
    const result = await api("/admin/orders");
    state.adminOrders = result.orders || [];
    state.adminCustomers = result.customers || {};
    state.adminEvents = {};
    state.adminEventActors = {};
    state.adminSelectedOrderId = null;
    state.adminView = "orders";
    state.auditLogs = [];
    state.auditActors = {};
    state.auditNextPageToken = null;
    bindAdminControls();
    renderAdminOrders();
    await switchAdminView("orders");
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
  if (await requireSignedIn()) addItem("farm_melhorias", 1);
});
$("[data-wons]")?.addEventListener("click", async () => {
  if (await requireSignedIn()) addItem("farm_wons_1b", wonsQuantity.value);
});
$("[data-power-roll]")?.addEventListener("click", async () => {
  if (await requireSignedIn()) addItem("power_roll", rollQuantity.value);
});

$("#checkout-button")?.addEventListener("click", async () => {
  if (!(await requireSignedIn())) return;
  hideAll();
  renderCheckoutSummary();
  show($("#checkout-modal"));
});
$("#checkout-form")?.addEventListener("submit", submitOrders);
overlay?.addEventListener("click", hideAll);

document.addEventListener("click", async event => {
  const authButton = event.target.closest("[data-auth]");
  if (authButton) {
    event.preventDefault();
    state.user ? await signOut(auth) : await enterWithGoogle();
    return;
  }
  const target = event.target.closest("[data-open-products],[data-open-cart],[data-open-tickets],[data-open-reviews],[data-open-faq],[data-open-admin],[data-close]");
  if (!target) return;
  event.preventDefault();
  if (target.matches("[data-close]")) {
    hideAll();
    return;
  }
  hideAll();
  if (target.matches("[data-open-products]")) show($("#produtos"));
  else if (target.matches("[data-open-cart]")) show(drawer);
  else if (target.matches("[data-open-tickets]")) await openOrders();
  else if (target.matches("[data-open-reviews]")) { renderReviews(); show($("#reviews-modal")); }
  else if (target.matches("[data-open-faq]")) show($("#faq-modal"));
  else if (target.matches("[data-open-admin]")) await openAdmin();
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
    state.adminOrders = [];
    state.adminCustomers = {};
    state.adminEvents = {};
    state.adminEventActors = {};
    state.auditLogs = [];
    state.auditActors = {};
    state.auditNextPageToken = null;
    state.cart = [];
    state.checkoutAttemptId = null;
    updateAccountButton();
    renderCart();
  }
});

renderCart();
renderReviews();
loadProducts();

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
const state = { user: null, account: null, isAdmin: false, products: new Map(), discountConfig: { active: false }, cart: [], orders: [], adminOrders: [], adminCustomers: {}, submitting: false };
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
  const button = event.currentTarget.querySelector("button[type='submit']");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Calculando no servidor...";
  try {
    const order = await api("/createOrder", {
      method: "POST",
      body: JSON.stringify({ items: state.cart.map(item => ({ productId: item.productId, quantity: item.quantity })) }),
    });
    state.cart = [];
    await loadAccount();
    renderCart();
    hideAll();
    const discountMessage = order.discountCents > 0 ? ` Desconto reservado: ${currencyFromCents(order.discountCents)}.` : "";
    notify(`Pedido criado por ${currencyFromCents(order.totalCents)}.${discountMessage}`, "success");
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
  $("[data-cancel-order]")?.addEventListener("click", () => cancelOrder(order.id));
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

function renderAdminOrders() {
  const list = $("#admin-orders-list");
  if (!list) return;
  if (!state.adminOrders.length) {
    list.innerHTML = '<p class="empty">Nenhum pedido encontrado.</p>';
    return;
  }
  list.innerHTML = state.adminOrders.map(order => {
    const customer = state.adminCustomers[order.userId] || {};
    const action = nextAdminAction(order);
    return `<article class="admin-order">
      <div><span class="ticket-status pending">${escapeHtml(statusLabel(order.status))}</span><h3>#${escapeHtml(order.id.slice(0, 10).toUpperCase())} · ${escapeHtml(orderProduct(order))}</h3>
      <p>${escapeHtml(customer.displayName || "Cliente")} · ${escapeHtml(customer.email || order.userId)}</p>
      <small>Total ${currencyFromCents(order.totalCents)} · Pagamento ${escapeHtml(order.paymentStatus || "UNPAID")}</small></div>
      ${action ? `<button class="button primary" data-admin-action="${escapeHtml(action.route)}" data-admin-order="${escapeHtml(order.id)}">${escapeHtml(action.label)}</button>` : '<span class="admin-locked">Aguardando confirmação financeira confiável</span>'}
    </article>`;
  }).join("");
  document.querySelectorAll("[data-admin-action]").forEach(button => button.addEventListener("click", () => runAdminAction(button.dataset.adminOrder, button.dataset.adminAction)));
}

async function openAdmin() {
  hideAll();
  show($("#admin-modal"));
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
    renderAdminOrders();
  } catch (error) {
    list.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

async function runAdminAction(orderId, route) {
  const allowedRoutes = new Set(["/admin/openTicket", "/admin/startService", "/admin/completeService"]);
  if (!allowedRoutes.has(route)) return;
  try {
    const result = await api(route, { method: "POST", body: JSON.stringify({ orderId }) });
    notify(result.alreadyApplied ? "A ação já havia sido aplicada." : "Ação concluída e registrada na auditoria.", "success");
    await openAdmin();
  } catch (error) {
    notify(error.message, "error");
  }
}

async function cancelOrder(orderId) {
  if (!window.confirm("Cancelar este pedido? Se houver desconto reservado, ele será liberado.")) return;
  try {
    const result = await api("/cancelOrder", { method: "POST", body: JSON.stringify({ orderId }) });
    notify(result.alreadyApplied ? "O pedido já estava cancelado." : "Pedido cancelado com segurança.", "success");
    await loadAccount();
    await openOrders();
  } catch (error) {
    notify(error.message, "error");
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
    state.cart = [];
    updateAccountButton();
    renderCart();
  }
});

renderCart();
renderReviews();
loadProducts();

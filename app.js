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
const state = { user: null, account: null, products: new Map(), cart: [], orders: [], submitting: false };
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
  if (!button) return;
  if (!state.user) {
    button.textContent = "Entrar com Google";
    button.classList.remove("admin");
    button.title = "";
    return;
  }
  const isAdmin = state.account?.role === "admin";
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
    updateDisplayedPrices();
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
  }
  if (roll) {
    const price = $("[data-power-roll]")?.closest(".card-bottom")?.querySelector("strong");
    if (price) price.textContent = `${currencyFromCents(roll.priceCents)} cada`;
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
  const safeQuantity = Math.max(1, Math.min(100000, Math.floor(Number(quantity) || 1)));
  const existing = state.cart.find(item => item.productId === productId);
  if (existing) existing.quantity = Math.min(100000, existing.quantity + safeQuantity);
  else state.cart.push({ productId, name: itemProduct.name, quantity: safeQuantity, unitPriceCents: itemProduct.priceCents });
  renderCart();
  hideAll();
  show(drawer);
}

function renderCart() {
  const totalCents = state.cart.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const count = state.cart.length;
  $("#cart-count").textContent = count;
  $("#side-cart-count").textContent = count;
  $("#cart-total").textContent = currencyFromCents(totalCents);
  $("#checkout-button").disabled = count === 0 || state.submitting;
  $("#cart-items").innerHTML = count
    ? state.cart.map((item, index) => `
      <div class="cart-item">
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <small>${item.quantity} × ${currencyFromCents(item.unitPriceCents)}</small>
        </div>
        <button data-remove="${index}" aria-label="Remover ${escapeHtml(item.name)}">×</button>
      </div>`).join("")
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
  const total = state.cart.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  summary.innerHTML = `${state.cart.map(item => `<p><span>${item.quantity} × ${escapeHtml(item.name)}</span><strong>${currencyFromCents(item.unitPriceCents * item.quantity)}</strong></p>`).join("")}<p class="checkout-total"><span>Total</span><strong>${currencyFromCents(total)}</strong></p>`;
}

async function submitOrders(event) {
  event.preventDefault();
  if (state.submitting || !state.cart.length) return;
  if (!(await requireSignedIn())) return;
  state.submitting = true;
  const button = event.currentTarget.querySelector("button[type='submit']");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Criando pedido seguro...";
  const pendingItems = [...state.cart];
  const results = await Promise.allSettled(pendingItems.map(item => api("/createOrder", {
    method: "POST",
    body: JSON.stringify({ productId: item.productId, quantity: item.quantity }),
  })));
  const failures = [];
  const created = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") created.push(result.value);
    else failures.push(pendingItems[index]);
  });
  state.cart = failures;
  state.submitting = false;
  button.disabled = false;
  button.textContent = original;
  renderCart();
  if (created.length) {
    hideAll();
    notify(`${created.length} pedido(s) criado(s). Aguardando pagamento.`, "success");
    await openOrders();
  } else {
    notify(results[0]?.reason?.message || "Não foi possível criar o pedido.", "error");
  }
}

function statusLabel(status) {
  return ({ AWAITING_PAYMENT: "AGUARDANDO PAGAMENTO", PAYMENT_CONFIRMED: "PAGAMENTO CONFIRMADO", COMPLETED: "CONCLUÍDO" })[status] || status || "EM ANÁLISE";
}

function orderProduct(order) {
  const first = order.items?.[0];
  return first ? `${first.quantity} × ${first.name}` : "Pedido";
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
        <p>Total confirmado pelo servidor: ${currencyFromCents(order.totalCents)}</p>
        <small>Pedido salvo com segurança no banco de dados</small>
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
      <div><small>VALOR</small><strong>${currencyFromCents(order.totalCents)}</strong></div>
      <div><small>STATUS</small><strong>${escapeHtml(statusLabel(order.status))}</strong></div>
    </div>
    <div class="review-card"><span>✓</span><div><strong>Pedido registrado</strong><p>O preço foi conferido no servidor. O PIX automático será conectado na próxima etapa.</p></div></div>
    <button class="button primary" data-back-orders>Voltar aos pedidos</button>`;
  $("[data-back-orders]")?.addEventListener("click", openOrders);
}

function renderReviews() {
  const modal = $("#reviews-modal .modal-box");
  modal.innerHTML = `
    <button class="close" data-close aria-label="Fechar">×</button>
    <p class="eyebrow"><i></i> AVALIAÇÕES</p>
    <h2>Avaliações de clientes.</h2>
    <div class="empty-info"><span>★</span><strong>Somente compradores confirmados</strong><p>A avaliação será liberada pelo servidor apenas após o pedido ficar concluído.</p><button class="button primary" data-open-products>Ver produtos <span>→</span></button></div>`;
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
  const target = event.target.closest("[data-open-products],[data-open-cart],[data-open-tickets],[data-open-reviews],[data-open-faq],[data-close]");
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
});

onAuthStateChanged(auth, async user => {
  state.user = user;
  state.account = null;
  updateAccountButton();
  if (user) await loadAccount();
  else {
    state.orders = [];
    state.cart = [];
    renderCart();
  }
});

renderCart();
renderReviews();
loadProducts();

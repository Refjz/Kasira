// Kasira app core: state, API client, offline cache + outbox, shared helpers and the render loop.
import { priceOrder } from "./pricing.js";

export const DAY = 86400000;
export const TRIAL_DAYS = 7;
export const ORDER_TYPES = ["Makan di sini", "Bawa pulang", "Ojol"];
export const METHODS = ["Tunai", "QRIS", "Kartu Debit", "Kartu Kredit", "Transfer", "E-Wallet"];
export const ROLE = { superadmin: "Pemilik Aplikasi", owner: "Pemilik Usaha", manager: "Manajer", cashier: "Kasir" };
// Every plan has all features and no limits; plans differ only in billing period.
export const PLANS = {
  bulanan: { name: "Bulanan", price: 99000, per: "bulan", monthly: 99000, feat: ["Semua fitur, tanpa batas", "Outlet, staf, dan produk tak terbatas", "Mode F&B dan minimarket", "Laporan lengkap & ekspor Excel", "Mode offline dan cetak struk"] },
  tahunan: { name: "Tahunan", price: 990000, per: "tahun", monthly: 82500, note: "Hemat 2 bulan", feat: ["Semua fitur, tanpa batas", "Outlet, staf, dan produk tak terbatas", "Mode F&B dan minimarket", "Laporan lengkap & ekspor Excel", "Mode offline dan cetak struk"] }
};

export const S = {
  booting: true, offline: false, session: null, tenant: null, staff: [], outlets: [], settings: null, outlet: "main",
  data: { products: [], stock: {}, transactions: [], bills: [], kitchen: [], customers: [], promos: [], suppliers: [], shift: null },
  admin: { tenants: [], transactions: [] },
  ui: { view: null, modal: null }
};
export const views = {}, actions = {}, forms = {}, inputs = {}, changes = {};

/* ---------- helpers ---------- */
export const isFnb = t => !!t && t.type === "F&B";
export const isRetail = t => !!t && (t.type === "Minimarket" || t.type === "Retail");
export const isMgr = u => !!u && (u.role === "owner" || u.role === "manager");
export const rp = n => (n < 0 ? "−Rp" : "Rp") + Math.abs(Math.round(+n || 0)).toLocaleString("id-ID");
export const nf = n => (Math.round((+n || 0) * 100) / 100).toLocaleString("id-ID");
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const initials = s => String(s || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
export const dayKey = t => { const d = new Date(t); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); };
export const daysTo = ts => Math.ceil((ts - Date.now()) / DAY);
export const fmtDate = ts => new Date(ts).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
export const fmtDT = ts => new Date(ts).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const modsText = m => m ? Object.entries(m).filter(([, v]) => v).map(([k, v]) => k + ": " + v).join(", ") : "";
export const isoDay = ts => { const d = new Date(ts); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const HUES = ["#0C7A62", "#C98A0C", "#7A4FB5", "#C2372F", "#2F6FB7", "#5E8C1E", "#B5507A", "#1B8A99"];
export function swatch(name) { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]; }
export const me = () => S.session ? S.session.user : null;
export const net = x => x.total - (x.refunded || 0);
export const outletName = id => (S.outlets.find(o => o.id === id) || {}).name || (id === "main" ? "Outlet utama" : id);
export const prodMap = () => new Map(S.data.products.map(p => [p.id, p]));
export const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

export function toast(msg) {
  document.querySelectorAll(".toast").forEach(x => x.remove());
  const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2800);
}

// Stock on hand in base units; Infinity for untracked items and services.
export function stockOf(p) {
  if (!p) return 0;
  if (Array.isArray(p.recipe) && p.recipe.length) {
    let best = Infinity;
    for (const r of p.recipe) { const ing = S.data.products.find(x => x.id === r.pid); if (!ing || ing.track === false || !r.qty) continue; best = Math.min(best, Math.floor((S.data.stock[ing.id] || 0) / r.qty)); }
    return best;
  }
  return p.track === false ? Infinity : (S.data.stock[p.id] || 0);
}

export function pricing(input, customer) {
  return priceOrder(input, { products: prodMap(), tax: S.tenant ? S.tenant.tax : 0, service: S.settings ? S.settings.service : 0, promos: S.data.promos, loyalty: S.settings ? S.settings.loyalty : {}, customer });
}

/* ---------- API ---------- */
export async function api(method, path, body) {
  const hasBody = method !== "GET" && method !== "DELETE";
  let res;
  try { res = await fetch("/api/" + path, { method, credentials: "same-origin", headers: hasBody ? { "content-type": "application/json" } : {}, body: hasBody ? JSON.stringify(body || {}) : undefined }); }
  catch (e) { const err = new Error("Tidak ada koneksi internet. Coba lagi saat online."); err.offline = true; throw err; }
  let data = {}; try { data = await res.json(); } catch (e) {}
  if (!res.ok) { const err = new Error(data.error || "Gagal memproses permintaan"); err.status = res.status; throw err; }
  return data;
}

/* ---------- offline cache & outbox ---------- */
const CACHE = "kasira-cache-v3", OUTBOX = "kasira-outbox";
export const outbox = () => lsGet(OUTBOX, []);
const saveOutbox = list => lsSet(OUTBOX, list);
function saveCache() {
  if (!S.session) return;
  lsSet(CACHE, { userId: S.session.user.id, session: S.session, tenant: S.tenant, staff: S.staff, outlets: S.outlets, settings: S.settings, outlet: S.outlet, data: S.data, at: Date.now() });
}
function loadCache() { return lsGet(CACHE, null); }

export function queueTrx(body, local) {
  const list = outbox(); list.push({ id: body.id, body, created: Date.now() }); saveOutbox(list);
  local.pending = true; S.data.transactions.unshift(local);
}
let syncing = false;
export async function sync() {
  if (syncing || !S.session) return;
  const list = outbox(); if (!list.length) return;
  syncing = true; let changed = false;
  try {
    for (const item of list) {
      if (item.error && item.tries >= 3) continue;
      try {
        const r = await api("POST", "trx", item.body);
        const i = S.data.transactions.findIndex(x => x.id === item.id);
        if (i >= 0) S.data.transactions[i] = r.trx; else S.data.transactions.unshift(r.trx);
        saveOutbox(outbox().filter(x => x.id !== item.id)); changed = true;
      } catch (e) {
        if (e.offline) break;
        if (e.status === 401) { toast("Sesi habis. Masuk lagi untuk mengirim transaksi offline."); break; }
        const cur = outbox(); const it = cur.find(x => x.id === item.id); if (it) { it.error = e.message; it.tries = (it.tries || 0) + 1; saveOutbox(cur); }
      }
    }
  } finally { syncing = false; }
  if (changed) { S.offline = false; toast("Transaksi offline sudah terkirim ke server"); try { await loadData(); } catch (e) {} render(); }
}
export function dropOutbox(id) { saveOutbox(outbox().filter(x => x.id !== id)); S.data.transactions = S.data.transactions.filter(x => !(x.id === id && x.pending)); }

/* ---------- boot & data ---------- */
export const usable = t => !t || t.access === "trial" || t.access === "paid";
export async function loadData() {
  const d = await api("GET", "data?outlet=" + encodeURIComponent(S.outlet));
  S.outlet = d.outlet;
  // Keep offline sales that have not reached the server yet.
  const pending = S.data.transactions.filter(x => x.pending && !d.transactions.some(y => y.id === x.id));
  S.data = { ...d, transactions: [...pending, ...d.transactions] };
  saveCache();
}
export async function boot(opts = {}) {
  S.booting = !opts.quiet; render();
  try {
    const m = await api("GET", "me");
    S.session = { user: m.user, impersonating: m.impersonating };
    S.tenant = m.tenant; S.staff = m.staff || []; S.outlets = m.outlets || []; S.settings = m.settings;
    const saved = lsGet("kasira-outlet-" + m.user.id, null);
    S.outlet = m.user.role === "cashier" && m.user.outletId ? m.user.outletId : (saved && S.outlets.some(o => o.id === saved) ? saved : "main");
    S.offline = false;
    if (m.user.role === "superadmin" && !m.impersonating) { const a = await api("GET", "admin/tenants"); S.admin = a; }
    else if (m.tenant && usable(m.tenant)) await loadData();
  } catch (e) {
    if (e.offline) {
      const c = loadCache();
      if (c && c.session) { Object.assign(S, { session: c.session, tenant: c.tenant, staff: c.staff, outlets: c.outlets, settings: c.settings, outlet: c.outlet, data: c.data, offline: true }); }
      else { S.session = null; toast(e.message); }
    } else { S.session = null; if (e.status !== 401) toast(e.message); }
  }
  S.booting = false; render();
  sync();
}
export function setOutlet(id) { S.outlet = id; lsSet("kasira-outlet-" + me().id, id); }
window.addEventListener("online", () => { if (S.offline) boot({ quiet: true }); else sync(); });
window.addEventListener("offline", () => { S.offline = true; render(); });
setInterval(() => { if (navigator.onLine) sync(); }, 20000);

/* ---------- receipt ---------- */
export function receiptText(x, width = 32) {
  const t = S.tenant || {}, st = S.settings || {};
  const W = width, line = "-".repeat(W);
  const pad = (a, b) => { a = String(a); b = String(b); return a.length + b.length + 1 > W ? a + "\n" + " ".repeat(Math.max(0, W - b.length)) + b : a + " ".repeat(W - a.length - b.length) + b; };
  const center = s => { s = String(s); return s.length >= W ? s : " ".repeat(Math.floor((W - s.length) / 2)) + s; };
  const o = S.outlets.find(o => o.id === (x.outletId || "main"));
  let s = center((t.name || "").toUpperCase()) + "\n";
  const addr = (o && o.address) || st.address || t.city; if (addr) s += center(addr) + "\n";
  if (o && o.id !== "main") s += center(o.name) + "\n";
  if (st.phone) s += center(st.phone) + "\n";
  s += line + "\n" + pad(x.id, "") + "\n" + new Date(x.time).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) + "\nKasir: " + (x.cashierName || "-") + "\n";
  if (x.orderType) s += x.orderType + (x.table ? " · Meja " + x.table : "") + "\n";
  if (x.customer) s += "Member: " + x.customer.name + "\n";
  s += line + "\n";
  for (const i of x.items) {
    s += i.name + (i.unit ? " (" + i.unit + ")" : "") + "\n";
    if (i.mods) s += "  " + modsText(i.mods) + "\n";
    if (i.note) s += "  Catatan: " + i.note + "\n";
    s += pad("  " + i.qty + " x " + i.price.toLocaleString("id-ID"), (i.qty * i.price).toLocaleString("id-ID")) + "\n";
  }
  s += line + "\n" + pad("Subtotal", x.subtotal.toLocaleString("id-ID")) + "\n";
  if (x.promo) s += pad(x.promo.name, "-" + x.promo.amount.toLocaleString("id-ID")) + "\n";
  if (x.manualDisc) s += pad("Diskon " + x.discPct + "%", "-" + x.manualDisc.toLocaleString("id-ID")) + "\n";
  if (x.voucher) s += pad("Voucher " + x.voucher.code, "-" + x.voucher.amount.toLocaleString("id-ID")) + "\n";
  if (x.pointsValue) s += pad("Tukar " + x.pointsRedeemed + " poin", "-" + x.pointsValue.toLocaleString("id-ID")) + "\n";
  if (x.service) s += pad("Service", x.service.toLocaleString("id-ID")) + "\n";
  if (x.tax) s += pad("Pajak " + (t.tax || 0) + "%", x.tax.toLocaleString("id-ID")) + "\n";
  s += pad("TOTAL", rp(x.total)) + "\n" + pad(x.method, rp(x.paid)) + "\n";
  if (x.change) s += pad("Kembali", rp(x.change)) + "\n";
  if (x.refunded) s += pad("Dikembalikan", "-" + rp(x.refunded)) + "\n" + (x.status === "void" ? center("*** DIBATALKAN ***") + "\n" : "");
  if (x.customer && x.pointsEarned) s += "Poin didapat: " + x.pointsEarned + "\n";
  if (x.pending) s += center("(belum tersinkron)") + "\n";
  return s + line + "\n" + center(st.receiptFooter || "Terima kasih") + "\n";
}

/* ---------- render ---------- */
const root = document.getElementById("root");
export const $ = sel => root.querySelector(sel);
export function openModal(fn) { S.ui.modal = typeof fn === "function" ? fn : () => fn; render(); const f = root.querySelector(".modal [autofocus], .modal input:not([type=hidden]), .modal select, .modal button"); if (f) f.focus(); }
export function closeModal() { S.ui.modal = null; render(); }
let shell = null;
export function setShell(fn) { shell = fn; }
export function render() {
  if (!shell) return;
  // Preserve focus and caret across re-renders so typing in inputs is not interrupted.
  const a = document.activeElement, id = a && a.id, pos = a && "selectionStart" in a ? (() => { try { return a.selectionStart; } catch (e) { return null; } })() : null;
  const scrollers = [...root.querySelectorAll("[data-keep-scroll]")].map(el => [el.dataset.keepScroll, el.scrollTop]);
  root.innerHTML = shell();
  for (const [k, top] of scrollers) { const el = root.querySelector(`[data-keep-scroll="${k}"]`); if (el) el.scrollTop = top; }
  if (id) { const el = document.getElementById(id); if (el && root.contains(el)) { el.focus({ preventScroll: true }); if (pos !== null) try { el.setSelectionRange(pos, pos); } catch (e) {} } }
}

/* ---------- event wiring ---------- */
function handleError(err, el) {
  toast(err.message);
  if (err.status === 401 && S.session && !S.offline) { S.session = null; S.ui.modal = null; render(); }
  else if (err.status === 402 || (err.status === 403 && /ditangguhkan/.test(err.message))) boot({ quiet: true });
  else if (el && el.isConnected) el.disabled = false;
}
root.addEventListener("click", async e => {
  const el = e.target.closest("[data-a]"); if (!el || el.disabled) return;
  const a = el.dataset.a;
  if (a === "scrim") { if (e.target === el) closeModal(); return; }
  const fn = actions[a]; if (!fn) return;
  try { await fn(el, e); } catch (err) { handleError(err, el); }
});
root.addEventListener("input", e => { const a = e.target.dataset.in; if (a && inputs[a]) inputs[a](e.target, e); });
root.addEventListener("change", e => { const a = e.target.dataset.ch; if (a && changes[a]) changes[a](e.target, e); });
root.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target, fn = forms[f.dataset.form]; if (!fn) return;
  let fd; try { fd = new FormData(f, e.submitter); } catch (x) { fd = new FormData(f); } const d = {};
  for (const [k, v] of fd.entries()) { if (k in d) d[k] = [].concat(d[k], v); else d[k] = v; }
  const btn = f.querySelector('[type="submit"]'); if (btn) btn.disabled = true;
  try { await fn(d, f, e.submitter); } catch (err) { handleError(err); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.ui.modal) closeModal(); });
actions.close = () => closeModal();

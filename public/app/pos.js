// Selling: cashier screen, options, payment (incl. split bill and automatic QRIS), receipts, refunds,
// open bills and tables, kitchen display, member lookup and camera scanning.
import { S, views, actions, forms, inputs, api, toast, render, openModal, closeModal, esc, rp, nf, uid, initials, swatch, modsText, daysTo, fmtDT,
  isFnb, isRetail, isMgr, me, stockOf, pricing, prodMap, queueTrx, receiptText, ORDER_TYPES, METHODS, $, lsGet } from "./core.js";
import { lineKey, stockEffects } from "./pricing.js";
import { printText, printerPrefs, widthFor } from "./print.js";
import { startScanner, stopScanner } from "./scan.js";

const P = () => S.ui.pos || (S.ui.pos = { cat: "Semua", q: "", cart: [], discPct: 0, voucher: "", customerId: null, redeem: 0, order: { type: "Makan di sini", table: "", label: "" }, billId: null });
export const resetPos = (keepType = true) => { const o = P(); S.ui.pos = { cat: o.cat, q: "", cart: [], discPct: 0, voucher: "", customerId: null, redeem: 0, order: { type: keepType ? o.order.type : "Makan di sini", table: "", label: "" }, billId: null }; };
const curBill = () => P().billId ? S.data.bills.find(b => b.id === P().billId) : null;
const customer = () => P().customerId ? S.data.customers.find(c => c.id === P().customerId) : null;
const sellable = () => S.data.products.filter(p => !p.ingredient);

function orderLines() {
  const b = curBill();
  return [...(b ? b.lines : []), ...P().cart];
}
function preview(lines) { const o = P(); return pricing({ lines: lines || orderLines(), discPct: o.discPct, voucherCode: o.voucher, redeemPoints: o.redeem }, customer()); }
function qtyInCart(pid) { return orderLines().filter(l => l.pid === pid).reduce((s, l) => { const p = S.data.products.find(x => x.id === pid); const u = l.unit && p && p.units ? p.units.find(u => u.name === l.unit) : null; return s + l.qty * (u ? u.qty : 1); }, 0); }

function addLine(p, opts = {}) {
  const o = P();
  const u = opts.unit && p.units ? p.units.find(x => x.name === opts.unit) : null, factor = u ? u.qty : 1;
  const avail = stockOf(p);
  if (avail !== Infinity && qtyInCart(p.id) + factor > avail) { toast("Stok " + p.name + " tidak cukup (sisa " + nf(avail) + ")"); return false; }
  const line = { pid: p.id, qty: 1, unit: u ? u.name : "", mods: opts.mods || null, note: opts.note || undefined };
  const key = lineKey(line) + "|" + (line.note || "");
  const ex = o.cart.find(x => x.key === key);
  if (ex) ex.qty++; else o.cart.push({ ...line, key });
  return true;
}

/* ---------- cashier screen ---------- */
views.pos = (u, t) => {
  const o = P(), b = curBill(), fnb = isFnb(t), retail = isRetail(t);
  const prods = sellable();
  const cats = ["Semua", ...new Set(prods.map(p => p.cat))];
  const q = o.q.toLowerCase();
  const shown = prods.filter(p => (o.cat === "Semua" || p.cat === o.cat) && (!q || p.name.toLowerCase().includes(q) || (p.sku || "").includes(q) || (p.units || []).some(x => (x.sku || "").includes(q))));
  const c = preview(), cust = customer();
  const needShift = S.settings && S.settings.requireShift && !S.data.shift;
  const lineRow = (l, i, sent) => {
    const p = S.data.products.find(x => x.id === l.pid) || { name: l.name || "?" };
    const priced = c.lines.find(x => x.key === lineKey(l)) || { price: 0 };
    return `<div class="line${sent ? " sent" : ""}"><div><div style="font-weight:600">${esc(p.name)}${l.unit ? ` <span class="pill">${esc(l.unit)}</span>` : ""}</div>${l.mods ? `<div class="muted" style="font-size:.8rem">${esc(modsText(l.mods))}</div>` : ""}${l.note ? `<div class="muted" style="font-size:.8rem">Catatan: ${esc(l.note)}</div>` : ""}<div class="muted num" style="font-size:.8rem">${rp(priced.price)}${priced.wholesale ? ' <span class="pill ok">grosir</span>' : ""}</div></div><div class="num" style="font-weight:700;text-align:right">${rp(priced.price * l.qty)}</div>
      ${sent ? `<div class="row" style="gap:.4rem"><span class="muted num" style="font-size:.85rem">${l.qty}× dipesan</span><button class="btn sm danger" data-a="billrm" data-i="${i}">Kurangi</button></div>`
        : `<div class="qty"><button data-a="dec" data-k="${esc(l.key)}" aria-label="Kurangi">−</button><span>${l.qty}</span><button data-a="inc" data-k="${esc(l.key)}" aria-label="Tambah">+</button></div>`}</div>`;
  };
  return `${needShift ? `<div class="trial-bar"><span><b>Shift belum dibuka.</b> <span class="muted">Buka shift dengan modal awal kas sebelum menerima pembayaran.</span></span><button class="btn sm primary" data-a="shiftopen">Buka shift</button></div>` : ""}
  <div class="spread"><div><h1>Kasir</h1><span class="pill ${fnb ? "gold" : "ok"}">Mode ${fnb ? "F&amp;B" : retail ? "Minimarket" : esc(t.type)}</span> ${S.outlets.length > 1 ? `<span class="pill">${esc((S.outlets.find(x => x.id === S.outlet) || {}).name || "")}</span>` : ""}</div>
    <div class="row">${S.data.bills.length ? `<button class="btn sm" data-a="nav" data-v="${fnb ? "tables" : "bills"}">Pesanan terbuka <span class="pill gold">${S.data.bills.length}</span></button>` : ""}<span class="muted" style="font-size:.9rem">${esc(u.name)}</span></div></div>
  <div class="pos">
    <section class="stack">
      <div class="scan"><div class="row" style="flex-wrap:nowrap"><input class="input" id="pos-q" type="search" placeholder="${retail ? "Scan barcode atau ketik nama, lalu Enter" : "Cari menu…"}" value="${esc(o.q)}" data-in="posq" autocomplete="off" enterkeyhint="search"><button class="btn" data-a="camscan" title="Scan pakai kamera" aria-label="Scan barcode pakai kamera">${ICON_CAM}</button></div></div>
      <div class="cats" role="group" aria-label="Kategori">${cats.map(k => `<button data-a="cat" data-v="${esc(k)}" aria-pressed="${o.cat === k}">${esc(k)}</button>`).join("")}</div>
      <div class="prods">${shown.map(p => {
        const n = qtyInCart(p.id), col = swatch(p.name), st = stockOf(p), ed = p.exp ? daysTo(p.exp) : null, out = st !== Infinity && st <= 0;
        return `<button class="prod${out ? " out" : ""}" data-a="add" data-id="${p.id}" ${out ? "disabled" : ""}>
        ${n ? `<span class="q">${nf(n)}</span>` : ""}
        <span class="sw" style="background:color-mix(in srgb, ${col} 18%, transparent);color:${col}">${initials(p.name)}</span>
        <span class="nm">${esc(p.name)}</span><span class="pr">${rp(p.price)}</span>
        ${p.whole ? `<span class="st" style="color:var(--accent)">Grosir ≥${p.whole.min}: ${rp(p.whole.price)}</span>` : ""}
        ${p.units ? `<span class="st muted">Juga per ${p.units.map(x => esc(x.name)).join(", ")}</span>` : ""}
        ${p.mods ? `<span class="st muted">Pilih ${p.mods.map(m => esc(m.name.toLowerCase())).join(" & ")}</span>` : ""}
        ${ed !== null && ed <= 14 ? `<span class="st" style="color:var(--bad)">Kedaluwarsa ${ed <= 0 ? "hari ini" : ed + " hari lagi"}</span>` : ""}
        <span class="st ${out ? "down" : "muted"}" ${!out && st !== Infinity && st <= (p.minStock || 10) ? 'style="color:var(--warn)"' : ""}>${st === Infinity ? (p.recipe ? "Dibuat sesuai pesanan" : "Layanan") : out ? "Stok habis" : "Stok " + nf(st) + " " + esc(p.unit || "")}</span></button>`;
      }).join("") || `<p class="empty">Produk tidak ditemukan.</p>`}</div>
    </section>
    <aside class="panel cart">
      <div class="spread"><h2>${b ? (b.table ? "Meja " + esc(b.table) : esc(b.label || "Pesanan terbuka")) : "Pesanan"}</h2><div class="row">${b ? `<button class="btn sm" data-a="billexit">Tutup</button>` : ""}${o.cart.length ? `<button class="btn sm danger" data-a="clear">Kosongkan</button>` : ""}</div></div>
      ${fnb && !b ? `<div class="stack" style="gap:.5rem"><div class="seg" role="group" aria-label="Jenis pesanan">${ORDER_TYPES.map(x => `<button data-a="otype" data-v="${x}" aria-pressed="${o.order.type === x}">${x}</button>`).join("")}</div>
        ${o.order.type === "Makan di sini" ? `<div class="row" style="flex-wrap:nowrap"><label for="tbl" style="font-weight:600;font-size:.85rem;white-space:nowrap">Meja</label>${(S.settings.tables || []).length ? `<select class="input" id="tbl" data-ch="table"><option value="">Pilih meja</option>${S.settings.tables.map(x => `<option ${o.order.table === x.name ? "selected" : ""} ${S.data.bills.some(bb => bb.table === x.name) ? "disabled" : ""}>${esc(x.name)}</option>`).join("")}</select>` : `<input class="input" id="tbl" data-in="table" inputmode="numeric" value="${esc(o.order.table)}" placeholder="mis. 5" style="max-width:110px">`}</div>` : ""}</div>` : ""}
      <button class="btn sm" data-a="custpick" style="justify-content:flex-start">${cust ? `👤 ${esc(cust.name)} · <span class="num">${nf(cust.points || 0)} poin</span>` : "＋ Pilih pelanggan / member"}</button>
      <div class="cart-lines" data-keep-scroll="cart">${b && b.lines.length ? `<div class="label">Sudah dipesan</div>${b.lines.map((l, i) => lineRow(l, i, true)).join("")}${o.cart.length ? `<div class="label">Tambahan</div>` : ""}` : ""}
        ${o.cart.map(l => lineRow(l, 0, false)).join("")}
        ${!o.cart.length && !(b && b.lines.length) ? `<p class="empty" style="padding:1.2rem 0">${retail ? "Scan barcode atau ketuk produk." : "Ketuk menu untuk menambah pesanan."}</p>` : ""}</div>
      <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="disc">Diskon (%)</label><input class="input" id="disc" type="number" min="0" max="100" value="${o.discPct || ""}" placeholder="0" data-in="disc"></div>
        <div class="field" style="flex:1.4"><label for="vc">Kode voucher</label><input class="input" id="vc" value="${esc(o.voucher)}" data-in="voucher" placeholder="opsional" autocomplete="off" style="text-transform:uppercase"></div></div>
      ${c.voucherError && o.voucher ? `<span class="down" style="font-size:.82rem">${esc(c.voucherError)}</span>` : ""}
      <div class="sum">${sumRows(c)}</div>
      <div class="row" style="flex-wrap:nowrap">
        ${(o.cart.length || b) ? `<button class="btn" style="flex:1" data-a="hold">${b ? (o.cart.length ? (fnb ? "Kirim ke dapur" : "Simpan tambahan") : "Simpan") : (fnb ? "Simpan & kirim ke dapur" : "Tahan pesanan")}</button>` : ""}
        <button class="btn primary" style="flex:1.4;padding:.8rem;font-size:1.02rem" data-a="pay" ${orderLines().length ? "" : "disabled"}>Bayar ${orderLines().length ? rp(c.total) : ""}</button>
      </div>
    </aside>
  </div>`;
};
export function sumRows(c) {
  const t = S.tenant;
  return `<div><span class="muted">Subtotal</span><span class="num">${rp(c.subtotal)}</span></div>
    ${c.saved ? `<div><span class="muted">Hemat harga grosir</span><span class="num up">${rp(c.saved)}</span></div>` : ""}
    ${c.promo ? `<div><span class="muted">Promo: ${esc(c.promo.name)}</span><span class="num down">−${rp(c.promo.amount)}</span></div>` : ""}
    ${c.manual ? `<div><span class="muted">Diskon ${c.discPct}%</span><span class="num down">−${rp(c.manual)}</span></div>` : ""}
    ${c.voucher ? `<div><span class="muted">Voucher ${esc(c.voucher.code)}</span><span class="num down">−${rp(c.voucher.amount)}</span></div>` : ""}
    ${c.pointsValue ? `<div><span class="muted">Tukar ${nf(c.pointsRedeemed)} poin</span><span class="num down">−${rp(c.pointsValue)}</span></div>` : ""}
    ${c.service ? `<div><span class="muted">Service ${S.settings.service}%</span><span class="num">${rp(c.service)}</span></div>` : ""}
    ${t.tax ? `<div><span class="muted">Pajak ${t.tax}%</span><span class="num">${rp(c.tax)}</span></div>` : ""}
    <div class="total"><span>Total</span><span class="num">${rp(c.total)}</span></div>`;
}
const ICON_CAM = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8M18 8v8"/></svg>`;

inputs.posq = el => { P().q = el.value; render(); };
inputs.table = el => { P().order.table = el.value; };
inputs.disc = el => { P().discPct = Math.min(Math.max(+el.value || 0, 0), 100); render(); };
inputs.voucher = el => { P().voucher = el.value.trim().toUpperCase(); render(); };
import { changes } from "./core.js";
changes.table = el => { P().order.table = el.value; };

actions.cat = el => { P().cat = el.dataset.v; render(); };
actions.otype = el => { P().order.type = el.dataset.v; render(); };
actions.clear = () => { P().cart = []; P().discPct = 0; P().voucher = ""; render(); };
actions.inc = el => { const x = P().cart.find(x => x.key === el.dataset.k); if (x) { const p = S.data.products.find(p => p.id === x.pid); const u = x.unit && p.units ? p.units.find(u => u.name === x.unit) : null; const st = stockOf(p); if (st !== Infinity && qtyInCart(p.id) + (u ? u.qty : 1) > st) toast("Stok tidak cukup"); else x.qty++; } render(); };
actions.dec = el => { const o = P(); const x = o.cart.find(x => x.key === el.dataset.k); if (x) { x.qty--; if (x.qty <= 0) o.cart = o.cart.filter(y => y !== x); } render(); };

let pick = { unit: "", mods: {}, note: "" };
function optionsModal(p) {
  return () => `<div class="spread"><h2>${esc(p.name)}</h2><button class="btn sm" data-a="close">Batal</button></div>
  ${p.units ? `<div class="field"><span class="label">Satuan</span><div class="seg" role="group" aria-label="Satuan">${[{ name: "", label: (p.unit || "pcs") + " · " + rp(p.price) }, ...p.units.map(x => ({ name: x.name, label: x.name + " (isi " + x.qty + ") · " + rp(x.price) }))].map(x => `<button data-a="pickunit" data-v="${esc(x.name)}" aria-pressed="${pick.unit === x.name}">${esc(x.label)}</button>`).join("")}</div></div>` : ""}
  ${(p.mods || []).map(m => `<div class="field"><span class="label">${esc(m.name)}</span><div class="seg" role="group" aria-label="${esc(m.name)}">${m.opts.map(x => `<button data-a="pickmod" data-g="${esc(m.name)}" data-v="${esc(x)}" aria-pressed="${pick.mods[m.name] === x}">${esc(x)}</button>`).join("")}</div></div>`).join("")}
  ${isFnb(S.tenant) ? `<div class="field"><label for="pnote">Catatan untuk dapur</label><input class="input" id="pnote" data-in="picknote" value="${esc(pick.note)}" placeholder="mis. tanpa bawang"></div>` : ""}
  <button class="btn primary" data-a="pickadd" data-id="${p.id}">Tambah ke pesanan</button>`;
}
inputs.picknote = el => { pick.note = el.value; };
actions.pickunit = el => { pick.unit = el.dataset.v; render(); };
actions.pickmod = el => { pick.mods[el.dataset.g] = el.dataset.v; render(); };
actions.pickadd = el => { const p = S.data.products.find(x => x.id === el.dataset.id); if (addLine(p, { unit: pick.unit, mods: p.mods ? { ...pick.mods } : null, note: pick.note.trim() || undefined })) toast(p.name + " ditambahkan"); closeModal(); };
function choose(p, unit) {
  if (p.mods || (p.units && unit === undefined) || isFnb(S.tenant) && p.mods) {
    pick = { unit: unit || "", mods: Object.fromEntries((p.mods || []).map(m => [m.name, m.opts[0]])), note: "" };
    openModal(optionsModal(p)); return;
  }
  if (addLine(p, { unit })) render();
}
actions.add = el => { const p = S.data.products.find(p => p.id === el.dataset.id); if (p) choose(p); };

export function scan(code) {
  code = String(code || "").trim(); if (!code) return;
  const prods = sellable();
  let p = prods.find(p => p.sku === code), unit;
  if (!p) for (const x of prods) { const u = (x.units || []).find(u => u.sku === code); if (u) { p = x; unit = u.name; break; } }
  if (!p) p = prods.find(p => p.name.toLowerCase() === code.toLowerCase()) || (() => { const m = prods.filter(p => p.name.toLowerCase().includes(code.toLowerCase())); return m.length === 1 ? m[0] : null; })();
  if (!p) { toast("Barcode " + code + " belum terdaftar"); return; }
  P().q = "";
  if (p.mods) { choose(p, unit || ""); return; }
  if (addLine(p, { unit: unit || "" })) toast(p.name + (unit ? " (" + unit + ")" : "") + " +1");
  render();
}
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "pos-q") { e.preventDefault(); scan(e.target.value); const s = $("#pos-q"); if (s) s.focus(); } });

/* camera */
let camTarget = null;
export function openCamera(onCode, title = "Scan barcode") {
  camTarget = onCode;
  openModal(() => `<div class="spread"><h2>${esc(title)}</h2><button class="btn sm" data-a="camclose">Selesai</button></div>
    <video id="camv" playsinline muted style="width:100%;border-radius:10px;background:#000;aspect-ratio:4/3;object-fit:cover"></video>
    <p class="muted" style="font-size:.85rem">Arahkan kamera ke barcode. Setiap barcode yang terbaca langsung masuk. Tekan Selesai kalau sudah.</p>`);
  const v = $("#camv");
  startScanner(v, code => camTarget && camTarget(code)).catch(e => { toast(e.message || "Kamera tidak bisa dibuka"); stopScanner(); closeModal(); });
}
actions.camscan = () => openCamera(code => { scan(code); const v = $("#camv"); if (!v) stopScanner(); });
actions.camclose = () => { stopScanner(); closeModal(); };

/* ---------- members ---------- */
let custQ = "";
function custModal() {
  return () => {
    const q = custQ.toLowerCase(), d = custQ.replace(/\D/g, "");
    const list = S.data.customers.filter(c => !q || c.name.toLowerCase().includes(q) || (d && c.phone.includes(d))).slice(0, 30);
    return `<div class="spread"><h2>Pelanggan</h2><button class="btn sm" data-a="close">Tutup</button></div>
    <input class="input" id="custq" data-in="custq" value="${esc(custQ)}" placeholder="Cari nama atau nomor HP" autocomplete="off" autofocus>
    <div class="stack" style="gap:.4rem;max-height:40vh;overflow:auto">${list.map(c => `<button class="acct" data-a="custset" data-id="${c.id}"><span class="avatar">${initials(c.name)}</span><span><b>${esc(c.name)}</b><br><span class="muted num" style="font-size:.82rem">${esc(c.phone)} · ${nf(c.points || 0)} poin</span></span></button>`).join("") || `<p class="muted">Belum ada yang cocok.</p>`}</div>
    ${P().customerId ? `<button class="btn" data-a="custset" data-id="">Lepas pelanggan dari pesanan</button>` : ""}
    <form class="panel stack" data-form="custquick"><h3>Daftarkan member baru</h3>
      <div class="row" style="flex-wrap:nowrap"><input class="input" name="name" required placeholder="Nama"><input class="input" name="phone" required inputmode="tel" placeholder="08xx" value="${esc(d.length > 5 ? custQ : "")}"></div>
      <button class="btn primary" type="submit">Simpan & pakai</button></form>`;
  };
}
inputs.custq = el => { custQ = el.value; render(); };
actions.custpick = () => { custQ = ""; openModal(custModal()); };
actions.custset = el => { P().customerId = el.dataset.id || null; P().redeem = 0; closeModal(); };
forms.custquick = async d => {
  const r = await api("PUT", "customers/" + uid("c"), { name: d.name, phone: d.phone });
  S.data.customers.push(r.customer); P().customerId = r.customer.id; closeModal(); toast(r.customer.name + " terdaftar sebagai member");
};

/* ---------- shift guard ---------- */
actions.shiftopen = () => openModal(`<h2>Buka shift</h2><p class="muted" style="font-size:.9rem">Hitung uang tunai di laci kasir sebelum mulai berjualan.</p>
  <form class="stack" data-form="shiftopen"><div class="field"><label for="oc">Modal awal kas</label><input class="input num" id="oc" name="openCash" type="number" min="0" required placeholder="0" autofocus></div>
  <div class="row"><button class="btn primary" type="submit">Buka shift</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`);
forms.shiftopen = async d => { const r = await api("POST", "shift/open", { openCash: +d.openCash, outlet: S.outlet }); S.data.shift = r.shift; closeModal(); toast("Shift dibuka. Selamat berjualan!"); };

/* ---------- hold / open bills ---------- */
actions.hold = async el => {
  const o = P(), t = S.tenant, b = curBill();
  if (!b && isFnb(t) && o.order.type === "Makan di sini" && !o.order.table.trim()) {
    openModal(`<h2>Simpan pesanan</h2><form class="stack" data-form="holdlabel"><div class="field"><label for="hl">Nama pesanan</label><input class="input" id="hl" name="label" required placeholder="mis. Pak Budi, Meja teras" autofocus></div><div class="row"><button class="btn primary" type="submit">Simpan</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`); return;
  }
  if (!b && !isFnb(t)) { openModal(`<h2>Tahan pesanan</h2><form class="stack" data-form="holdlabel"><div class="field"><label for="hl">Nama pesanan</label><input class="input" id="hl" name="label" required placeholder="mis. Ibu baju merah" autofocus></div><div class="row"><button class="btn primary" type="submit">Tahan</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`); return; }
  el.disabled = true; await saveBill(); render();
};
forms.holdlabel = async d => { P().order.label = d.label.trim(); await saveBill(); closeModal(); };
async function saveBill() {
  const o = P(), b = curBill();
  const r = await api("POST", "bills", { id: b ? b.id : undefined, outlet: S.outlet, lines: o.cart.map(l => ({ pid: l.pid, qty: l.qty, unit: l.unit, mods: l.mods, note: l.note })), table: b ? undefined : (o.order.type === "Makan di sini" ? o.order.table : ""), orderType: b ? undefined : o.order.type, label: b ? undefined : o.order.label, customerId: o.customerId || undefined });
  const i = S.data.bills.findIndex(x => x.id === r.bill.id); if (i >= 0) S.data.bills[i] = r.bill; else S.data.bills.push(r.bill);
  const sentNew = o.cart.length;
  if (!b) { toast("Pesanan " + (r.bill.table ? "meja " + r.bill.table : r.bill.label) + " disimpan" + (isFnb(S.tenant) ? " dan dikirim ke dapur" : "")); resetPos(); }
  else { o.cart = []; if (sentNew) toast(isFnb(S.tenant) ? "Tambahan dikirim ke dapur" : "Tambahan disimpan"); }
  return r.bill;
}
export function openBill(id) { const b = S.data.bills.find(x => x.id === id); if (!b) return; resetPos(); P().billId = id; P().customerId = b.customerId || null; S.ui.view = "pos"; render(); }
actions.billopen = el => openBill(el.dataset.id);
actions.billexit = () => { resetPos(); render(); };
actions.billrm = el => {
  const b = curBill(), l = b.lines[+el.dataset.i];
  openModal(`<h2>Kurangi ${esc(l.name)}?</h2><p class="muted" style="font-size:.9rem">Menu ini sudah dikirim ke dapur, jadi butuh PIN pemilik atau manajer.</p>
  <form class="stack" data-form="billrm" data-i="${el.dataset.i}"><div class="field"><label for="brq">Jumlah dikurangi</label><input class="input" id="brq" name="qty" type="number" min="1" max="${l.qty}" value="1" required></div>
  <div class="field"><label for="brr">Alasan</label><input class="input" id="brr" name="reason" required placeholder="mis. pelanggan batal"></div>
  <div class="field"><label for="brp">PIN manajer</label><input class="input num" id="brp" name="pin" type="password" inputmode="numeric" autocomplete="off" required></div>
  <div class="row"><button class="btn primary" type="submit">Kurangi</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`);
};
forms.billrm = async (d, f) => {
  const b = curBill();
  const r = await api("POST", "bills/" + encodeURIComponent(b.id) + "/remove", { idx: +f.dataset.i, qty: +d.qty, reason: d.reason, pin: d.pin });
  if (r.status === "open") { const i = S.data.bills.findIndex(x => x.id === b.id); S.data.bills[i] = r.bill; } else { S.data.bills = S.data.bills.filter(x => x.id !== b.id); resetPos(); }
  closeModal(); toast("Pesanan dikurangi");
};
actions.billcancel = el => openModal(`<h2>Batalkan pesanan ini?</h2><form class="stack" data-form="billcancel" data-id="${el.dataset.id}"><div class="field"><label for="bcr">Alasan</label><input class="input" id="bcr" name="reason" required></div><div class="field"><label for="bcp">PIN manajer</label><input class="input num" id="bcp" name="pin" type="password" inputmode="numeric" autocomplete="off" required></div><div class="row"><button class="btn danger" type="submit">Batalkan pesanan</button><button class="btn" type="button" data-a="close">Kembali</button></div></form>`);
forms.billcancel = async (d, f) => { await api("POST", "bills/" + encodeURIComponent(f.dataset.id) + "/cancel", { reason: d.reason, pin: d.pin }); S.data.bills = S.data.bills.filter(x => x.id !== f.dataset.id); if (P().billId === f.dataset.id) resetPos(); closeModal(); toast("Pesanan dibatalkan"); };

/* ---------- payment ---------- */
let pay = null;
const payLines = () => {
  const b = curBill();
  if (!b) return P().cart;
  if (!pay || !pay.split) return b.lines;
  return b.lines.map((l, i) => ({ ...l, qty: Math.min(l.qty, pay.sel[i] || 0) })).filter(l => l.qty > 0);
};
actions.pay = async el => {
  const o = P(), t = S.tenant;
  if (S.settings.requireShift && !S.data.shift) { actions.shiftopen(); return; }
  if (!curBill() && isFnb(t) && o.order.type === "Makan di sini" && !o.order.table.trim()) { toast("Pilih nomor meja dulu"); const x = $("#tbl"); if (x) x.focus(); return; }
  if (curBill() && o.cart.length) { el.disabled = true; await saveBill(); }
  pay = { method: "Tunai", paid: 0, split: false, sel: {}, qris: null };
  openModal(payModal);
};
function payModal() {
  const b = curBill(), o = P(), c = preview(payLines()), cust = customer();
  const quick = [c.total, Math.ceil(c.total / 10000) * 10000, Math.ceil(c.total / 50000) * 50000, Math.ceil(c.total / 100000) * 100000].filter((v, i, a) => v > 0 && a.indexOf(v) === i);
  const change = pay.paid - c.total, mt = S.settings.midtrans && S.settings.midtrans.configured && !S.offline;
  const loy = S.settings.loyalty || {};
  return `<div class="spread"><h2>Pembayaran</h2><button class="btn sm" data-a="payclose">Tutup</button></div>
  ${b && b.lines.length > 0 ? `<label class="row" style="font-weight:600"><input type="checkbox" data-a="splittoggle" ${pay.split ? "checked" : ""}> Bayar sebagian (split bill)</label>
    ${pay.split ? `<div class="panel stack" style="gap:.45rem;padding:.8rem">${b.lines.map((l, i) => `<div class="spread"><span>${esc(l.name)}${l.unit ? " (" + esc(l.unit) + ")" : ""} <span class="muted">× ${l.qty}</span></span><div class="qty"><button data-a="splitdec" data-i="${i}" aria-label="Kurangi">−</button><span>${pay.sel[i] || 0}</span><button data-a="splitinc" data-i="${i}" aria-label="Tambah">+</button></div></div>`).join("")}<button class="btn sm" data-a="splitall">Pilih semua</button></div>` : ""}` : ""}
  ${cust && loy.enabled && (cust.points || 0) > 0 ? `<div class="field"><label for="rdm">Tukar poin (${nf(cust.points)} tersedia, 1 poin = ${rp(loy.pointValue)})</label><input class="input num" id="rdm" type="number" min="0" max="${cust.points}" value="${o.redeem || ""}" placeholder="0" data-in="redeem"></div>` : ""}
  <div class="sum">${sumRows(c)}</div>
  <div class="methods">${METHODS.map(m => `<button data-a="method" data-v="${m}" aria-pressed="${pay.method === m}">${m}</button>`).join("")}</div>
  ${pay.method === "Tunai" ? `<div class="field"><label for="paid">Uang diterima</label><input class="input num" id="paid" type="number" min="0" value="${pay.paid || ""}" data-in="paid" placeholder="0" autofocus></div>
    <div class="row">${quick.map(v => `<button class="btn sm" data-a="quick" data-v="${v}">${v === c.total ? "Uang pas" : rp(v)}</button>`).join("")}</div>
    <div class="spread"><span class="muted">Kembalian</span><span class="num" id="chg" style="font-weight:700;font-size:1.2rem">${pay.paid ? (change >= 0 ? rp(change) : "Uang kurang " + rp(-change)) : "–"}</span></div>`
  : pay.method === "QRIS" ? (pay.qris ? `<div class="qris">${pay.qris.svg || (pay.qris.qrUrl ? `<img src="${esc(pay.qris.qrUrl)}" width="220" height="220" alt="Kode QRIS">` : "")}<b class="num">${rp(pay.qris.amount)}</b><span class="muted" style="font-size:.85rem">${pay.qris.status === "settlement" ? "✓ Pembayaran diterima" : "Menunggu pelanggan membayar… status dicek otomatis."}</span></div>`
      : `<div class="qris"><span class="muted" style="font-size:.9rem;text-align:center">${mt ? "Buat kode QRIS dinamis sesuai total. Status pembayaran terkonfirmasi otomatis." : "Minta pelanggan memindai QRIS toko, lalu konfirmasi setelah dana masuk."}</span>${mt ? `<button class="btn primary" data-a="qrismake">Buat QRIS ${rp(c.total)}</button>` : ""}</div>`)
  : `<p class="muted" style="font-size:.9rem">Konfirmasi setelah pembayaran ${pay.method.toLowerCase()} berhasil di mesin EDC, aplikasi, atau rekening.</p>`}
  <button class="btn primary" style="padding:.8rem" data-a="confirm" id="confirm-pay" ${(pay.method === "Tunai" && change < 0) || !payLines().length || (pay.qris && pay.qris.status !== "settlement") ? "disabled" : ""}>Selesaikan transaksi</button>`;
}
actions.payclose = () => { stopQrisPoll(); closeModal(); };
actions.method = el => { if (pay.qris && pay.qris.status !== "settlement" && el.dataset.v !== "QRIS") { stopQrisPoll(); pay.qris = null; } pay.method = el.dataset.v; render(); };
actions.quick = el => { pay.paid = +el.dataset.v; render(); };
actions.splittoggle = el => { pay.split = el.checked; if (pay.split) pay.sel = {}; render(); };
actions.splitinc = el => { const i = +el.dataset.i, b = curBill(); pay.sel[i] = Math.min((pay.sel[i] || 0) + 1, b.lines[i].qty); render(); };
actions.splitdec = el => { const i = +el.dataset.i; pay.sel[i] = Math.max((pay.sel[i] || 0) - 1, 0); render(); };
actions.splitall = () => { curBill().lines.forEach((l, i) => pay.sel[i] = l.qty); render(); };
inputs.paid = el => { pay.paid = +el.value || 0; const c = preview(payLines()), ch = pay.paid - c.total; const x = $("#chg"); if (x) x.textContent = pay.paid ? (ch >= 0 ? rp(ch) : "Uang kurang " + rp(-ch)) : "–"; const btn = $("#confirm-pay"); if (btn) btn.disabled = ch < 0; };
inputs.redeem = el => { P().redeem = Math.max(0, Math.floor(+el.value || 0)); render(); };

let qrisTimer = null;
const stopQrisPoll = () => { if (qrisTimer) clearInterval(qrisTimer); qrisTimer = null; };
actions.qrismake = async el => {
  el.disabled = true;
  const c = preview(payLines());
  const r = await api("POST", "qris/create", { amount: c.total, ref: P().billId || "" });
  pay.qris = { ...r, status: "pending", svg: await qrSvg(r.qrString) };
  render();
  stopQrisPoll();
  qrisTimer = setInterval(async () => {
    if (!pay || !pay.qris) return stopQrisPoll();
    try { const s = await api("GET", "qris/" + encodeURIComponent(pay.qris.id)); if (s.status !== pay.qris.status) { pay.qris.status = s.status; render(); }
      if (s.status === "settlement") { stopQrisPoll(); toast("QRIS diterima"); const btn = $("#confirm-pay"); if (btn) btn.click(); }
      else if (s.status !== "pending") { stopQrisPoll(); toast("QRIS " + s.status + ". Buat ulang kode QR."); pay.qris = null; render(); } } catch (e) {}
  }, 3000);
};
async function qrSvg(text) {
  if (!text) return "";
  if (!window.qrcode) await new Promise((ok, bad) => { const s = document.createElement("script"); s.src = "vendor/qrcode.js"; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  const q = window.qrcode(0, "M"); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 5, margin: 3, scalable: true }).replace("<svg ", '<svg style="width:230px;height:230px;background:#fff;border-radius:6px" role="img" aria-label="Kode QRIS" ');
}

actions.confirm = async el => {
  const o = P(), t = S.tenant, b = curBill(), lines = payLines();
  const c = preview(lines);
  if (c.voucherError && o.voucher) { toast(c.voucherError); return; }
  el.disabled = true; el.textContent = "Menyimpan…";
  const id = "TRX-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  const body = {
    id, outlet: S.outlet, lines: lines.map(l => ({ pid: l.pid, qty: l.qty, unit: l.unit, mods: l.mods, note: l.note })), discPct: o.discPct, voucherCode: o.voucher || undefined, redeemPoints: o.redeem || 0,
    customerId: o.customerId || undefined, method: pay.method, paid: pay.method === "Tunai" ? pay.paid : c.total, orderType: b ? b.orderType : o.order.type, table: b ? b.table : (o.order.type === "Makan di sini" ? o.order.table : ""),
    billId: b ? b.id : undefined, clientTotal: c.total, paymentId: pay.qris && pay.qris.status === "settlement" ? pay.qris.id : undefined, shiftId: S.data.shift ? S.data.shift.id : undefined
  };
  let x;
  try {
    if (S.offline) throw Object.assign(new Error("offline"), { offline: true });
    x = (await api("POST", "trx", body)).trx;
  } catch (e) {
    if (!e.offline) throw e;
    if (pay.qris) { toast("QRIS otomatis butuh internet"); el.disabled = false; el.textContent = "Selesaikan transaksi"; return; }
    const cust = customer();
    x = { id, outletId: S.outlet, cashierId: me().id, cashierName: me().name, shiftId: body.shiftId, time: Date.now(), items: c.lines, subtotal: c.subtotal, promo: c.promo, discPct: c.discPct, manualDisc: c.manual, voucher: c.voucher, pointsRedeemed: c.pointsRedeemed, pointsValue: c.pointsValue, discount: c.discount, service: c.service, tax: c.tax, total: c.total, method: pay.method, paid: body.paid, change: Math.max(0, body.paid - c.total), orderType: isFnb(t) ? body.orderType : undefined, table: body.table || undefined, customer: cust ? { id: cust.id, name: cust.name, phone: cust.phone } : null, pointsEarned: c.pointsEarned, refunds: [], refunded: 0, status: "ok" };
    queueTrx({ ...body, offline: true, time: x.time }, x);
    S.offline = true;
  }
  stopQrisPoll();
  // Mirror the server's stock and points changes locally so the screen stays right without a reload.
  const pm = prodMap();
  for (const l of c.lines) { const p = pm.get(l.pid); if (p) for (const e of stockEffects(p, l.factor, l.qty, id => pm.get(id))) S.data.stock[e.pid] = (S.data.stock[e.pid] || 0) - e.qty; }
  const cust = customer(); if (cust) { cust.points = Math.max(0, (cust.points || 0) - (x.pointsRedeemed || 0) + (x.pointsEarned || 0)); cust.visits = (cust.visits || 0) + 1; cust.spent = (cust.spent || 0) + x.total; }
  if (!x.pending) S.data.transactions.unshift(x);
  if (b) {
    for (const l of c.lines) { let need = l.qty; for (const bl of b.lines) if (need && lineKey(bl) === l.key) { const take = Math.min(bl.qty, need); bl.qty -= take; need -= take; } }
    b.lines = b.lines.filter(l => l.qty > 0);
    if (!b.lines.length) S.data.bills = S.data.bills.filter(y => y.id !== b.id);
  }
  const stillOpen = b && b.lines.length;
  if (!stillOpen) resetPos(); else { P().discPct = 0; P().voucher = ""; P().redeem = 0; }
  pay = null;
  openModal(receiptModal(x));
  toast((x.pending ? "Tersimpan di perangkat (offline): " : "Transaksi tersimpan: ") + x.id + (stillOpen ? ". Sisa pesanan masih terbuka." : ""));
  if (printerPrefs().auto) printText(receiptText(x, widthFor(printerPrefs().paper)));
};

/* ---------- receipt & refund ---------- */
export function receiptModal(x) {
  return () => `<div class="spread"><h2>Struk ${esc(x.id)}</h2><button class="btn sm" data-a="close">Tutup</button></div>
  ${x.status === "void" ? `<span class="pill bad">Dibatalkan</span>` : x.status === "partial" ? `<span class="pill gold">Sebagian dikembalikan ${rp(x.refunded)}</span>` : ""}${x.pending ? ` <span class="pill gold">menunggu sinkron</span>` : ""}
  <div class="receipt">${esc(receiptText(x, 34))}</div>
  ${(x.refunds || []).length ? `<div class="stack" style="gap:.3rem;font-size:.85rem">${x.refunds.map(r => `<div class="muted">${fmtDT(r.time)} · ${rp(r.amount)} via ${esc(r.method)} · ${esc(r.reason)} · disetujui ${esc(r.approvedBy)}</div>`).join("")}</div>` : ""}
  <div class="field"><label for="wa">Kirim struk ke WhatsApp</label><div class="row" style="flex-wrap:nowrap"><input class="input" id="wa" type="tel" inputmode="tel" placeholder="08xx xxxx xxxx" value="${esc(x.customer ? x.customer.phone : "")}"><button class="btn" data-a="wa" data-id="${esc(x.id)}">Kirim</button></div></div>
  <div class="row"><button class="btn" data-a="print" data-id="${esc(x.id)}">Cetak</button><button class="btn" data-a="copy" data-id="${esc(x.id)}">Salin</button>${!x.pending && x.status !== "void" ? `<button class="btn danger" data-a="refund" data-id="${esc(x.id)}">Batal / refund</button>` : ""}<button class="btn primary" data-a="close">Transaksi baru</button></div>`;
}
const findTrx = id => S.data.transactions.find(x => x.id === id) || (S.ui.trxList || []).find(x => x.id === id);
actions.viewtrx = el => openModal(receiptModal(findTrx(el.dataset.id)));
actions.print = el => printText(receiptText(findTrx(el.dataset.id), widthFor(printerPrefs().paper)));
actions.copy = el => { const txt = receiptText(findTrx(el.dataset.id), 32); navigator.clipboard.writeText(txt).then(() => toast("Struk disalin"), () => toast("Tidak bisa menyalin di perangkat ini")); };
actions.wa = el => {
  const n = ($("#wa").value || "").replace(/[\s-]/g, "");
  if (!/^(\+?62|0)8\d{7,12}$/.test(n)) { toast("Masukkan nomor WhatsApp yang dimulai 08"); return; }
  const intl = n.replace(/^\+/, "").replace(/^0/, "62");
  window.open("https://wa.me/" + intl + "?text=" + encodeURIComponent(receiptText(findTrx(el.dataset.id), 32)), "_blank", "noopener");
};
actions.refund = el => {
  const x = findTrx(el.dataset.id);
  const done = {}; for (const r of x.refunds || []) for (const it of r.items) done[it.idx] = (done[it.idx] || 0) + it.qty;
  openModal(() => `<h2>Batalkan atau refund ${esc(x.id)}</h2><p class="muted" style="font-size:.9rem">Stok dikembalikan otomatis. Butuh PIN pemilik atau manajer.</p>
  <form class="stack" data-form="refund" data-id="${esc(x.id)}">
    <label class="row" style="font-weight:600"><input type="checkbox" name="all" value="1" checked data-a="refall"> Batalkan seluruh transaksi</label>
    <div class="panel stack" id="refitems" style="gap:.45rem;padding:.8rem" hidden>${x.items.map((l, i) => { const left = l.qty - (done[i] || 0); return `<div class="spread"><span>${esc(l.name)} <span class="muted">(${left} bisa dikembalikan)</span></span><input class="input num" name="q${i}" type="number" min="0" max="${left}" value="0" style="width:80px" ${left ? "" : "disabled"}></div>`; }).join("")}</div>
    <div class="field"><label for="rfm">Uang dikembalikan lewat</label><select class="input" id="rfm" name="method">${METHODS.map(m => `<option ${m === x.method ? "selected" : ""}>${m}</option>`).join("")}</select></div>
    <div class="field"><label for="rfr">Alasan</label><input class="input" id="rfr" name="reason" required placeholder="mis. salah input, barang rusak"></div>
    <div class="field"><label for="rfp">PIN manajer</label><input class="input num" id="rfp" name="pin" type="password" inputmode="numeric" autocomplete="off" required></div>
    <div class="row"><button class="btn danger" type="submit">Proses</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`);
};
actions.refall = el => { const box = $("#refitems"); if (box) box.hidden = el.checked; };
forms.refund = async (d, f) => {
  const x = findTrx(f.dataset.id);
  const items = d.all ? null : x.items.map((l, i) => ({ idx: i, qty: +d["q" + i] || 0 })).filter(i => i.qty > 0);
  const r = await api("POST", "trx/" + encodeURIComponent(x.id) + "/refund", { all: !!d.all, items, reason: d.reason, pin: d.pin, method: d.method });
  const last = r.trx.refunds[r.trx.refunds.length - 1];
  const pm = prodMap();
  for (const it of last.items) { const l = x.items[it.idx], p = pm.get(l.pid); if (p) for (const e of stockEffects(p, l.factor || 1, it.qty, id => pm.get(id))) S.data.stock[e.pid] = (S.data.stock[e.pid] || 0) + e.qty; }
  Object.assign(x, r.trx);
  const li = (S.ui.trxList || []).findIndex(y => y.id === x.id); if (li >= 0) S.ui.trxList[li] = x;
  openModal(receiptModal(x)); toast("Refund " + rp(last.amount) + " tercatat");
};

/* ---------- open bills list (retail) and tables (F&B) ---------- */
const billTotal = b => pricing({ lines: b.lines }).total;
const mins = ts => Math.max(0, Math.round((Date.now() - ts) / 60000));
views.bills = () => `<div class="spread"><div><h1>Pesanan terbuka</h1><p class="muted">Pesanan yang ditahan dan belum dibayar.</p></div><button class="btn" data-a="billsreload">Muat ulang</button></div>
  <div class="panel tbl-wrap"><table><thead><tr><th>Pesanan</th><th>Dibuat</th><th class="r">Item</th><th class="r">Total</th><th></th></tr></thead><tbody>
  ${S.data.bills.map(b => `<tr><td><b>${esc(b.table ? "Meja " + b.table : b.label || b.id)}</b><div class="muted" style="font-size:.8rem">${esc(b.by || "")}</div></td><td class="num">${fmtDT(b.created)}</td><td class="r num">${b.lines.reduce((s, l) => s + l.qty, 0)}</td><td class="r num">${rp(billTotal(b))}</td><td class="r" style="white-space:nowrap"><button class="btn sm primary" data-a="billopen" data-id="${b.id}">Buka</button> <button class="btn sm danger" data-a="billcancel" data-id="${b.id}">Batalkan</button></td></tr>`).join("") || `<tr><td colspan="5" class="empty">Tidak ada pesanan terbuka.</td></tr>`}
  </tbody></table></div>`;
actions.billsreload = async () => { S.data.bills = (await api("GET", "bills?outlet=" + encodeURIComponent(S.outlet))).bills; render(); };

views.tables = () => {
  const tables = S.settings.tables || [];
  const areas = [...new Set(tables.map(x => x.area || "Dalam"))];
  const loose = S.data.bills.filter(b => !b.table || !tables.some(x => x.name === b.table));
  const tile = x => { const b = S.data.bills.find(b => b.table === x.name); const m = b ? mins(b.created) : 0;
    return b ? `<button class="tbl busy${m >= 60 ? " late" : ""}" data-a="billopen" data-id="${b.id}"><b>${esc(x.name)}</b><span class="num">${rp(billTotal(b))}</span><span class="muted" style="font-size:.78rem">${b.lines.reduce((s, l) => s + l.qty, 0)} item · ${m} mnt</span></button>`
      : `<button class="tbl" data-a="tblnew" data-v="${esc(x.name)}"><b>${esc(x.name)}</b><span class="muted" style="font-size:.78rem">Kosong</span></button>`; };
  return `<div class="spread"><div><h1>Meja</h1><p class="muted">${S.data.bills.filter(b => b.table).length} meja terisi dari ${tables.length}. Ketuk meja kosong untuk pesanan baru, ketuk meja terisi untuk tambah pesanan atau bayar.</p></div><div class="row"><button class="btn" data-a="tblreload">Muat ulang</button>${S.ui.view && me().role === "owner" ? `<button class="btn" data-a="nav" data-v="settings">Atur meja</button>` : ""}</div></div>
  ${tables.length ? areas.map(a => `<section class="stack" style="gap:.6rem"><h2>${esc(a)}</h2><div class="tblgrid">${tables.filter(x => (x.area || "Dalam") === a).map(tile).join("")}</div></section>`).join("") : `<div class="panel"><p class="muted">Belum ada meja. Pemilik usaha bisa menambah daftar meja di Pengaturan.</p></div>`}
  ${loose.length ? `<section class="stack" style="gap:.6rem"><h2>Pesanan tanpa meja</h2><div class="tblgrid">${loose.map(b => `<button class="tbl busy" data-a="billopen" data-id="${b.id}"><b>${esc(b.label || b.orderType || "Pesanan")}</b><span class="num">${rp(billTotal(b))}</span><span class="muted" style="font-size:.78rem">${mins(b.created)} mnt</span></button>`).join("")}</div></section>` : ""}`;
};
actions.tblnew = el => { resetPos(); P().order = { type: "Makan di sini", table: el.dataset.v, label: "" }; S.ui.view = "pos"; render(); };
actions.tblreload = actions.billsreload;

/* ---------- kitchen ---------- */
const KITCHEN = { baru: "Baru", proses: "Diproses", siap: "Siap diambil" };
views.kitchen = () => {
  const open = S.data.kitchen.slice().sort((a, b) => a.time - b.time);
  const col = k => { const list = open.filter(x => x.status === k); return `<section class="kcol"><div class="spread"><h2>${KITCHEN[k]}</h2><span class="pill ${k === "siap" ? "ok" : k === "baru" ? "gold" : ""}">${list.length}</span></div>
    ${list.map(x => { const m = mins(x.time), late = m >= 15 && k !== "siap"; return `<article class="kcard${late ? " late" : ""}"><div class="spread"><b>${x.table ? "Meja " + esc(x.table) : esc(x.label || x.orderType || "Pesanan")}</b><span class="num ${late ? "down" : "muted"}" style="font-size:.85rem">${m} mnt</span></div>
      <div class="muted" style="font-size:.78rem">${esc(x.orderType || "")}${x.by ? " · " + esc(x.by) : ""}</div>
      <ul>${x.lines.map(i => `<li><b class="num">${i.qty}×</b> ${esc(i.name)}${i.mods ? `<div class="muted" style="font-size:.8rem">${esc(modsText(i.mods))}</div>` : ""}${i.note ? `<div style="font-size:.8rem;color:var(--warn)">${esc(i.note)}</div>` : ""}</li>`).join("")}</ul>
      <div class="row"><button class="btn sm ${k === "siap" ? "" : "primary"}" data-a="kstep" data-id="${x.id}">${k === "baru" ? "Mulai buat" : k === "proses" ? "Tandai siap" : "Serahkan"}</button><button class="btn sm" data-a="kprint" data-id="${x.id}">Cetak tiket</button></div></article>`; }).join("") || `<p class="muted" style="font-size:.9rem">Kosong.</p>`}</section>`; };
  return `<div class="spread"><div><h1>Dapur</h1><p class="muted">Pesanan dari kasir dan meja masuk otomatis (diperbarui tiap 15 detik). Kartu merah berarti sudah menunggu 15 menit atau lebih.</p></div><button class="btn" data-a="kreload">Muat ulang</button></div>
  <div class="kboard">${col("baru")}${col("proses")}${col("siap")}</div>`;
};
actions.kreload = async () => { S.data.kitchen = (await api("GET", "kitchen?outlet=" + encodeURIComponent(S.outlet))).kitchen; render(); };
actions.kstep = async el => {
  const x = S.data.kitchen.find(x => x.id === el.dataset.id); const next = { baru: "proses", proses: "siap", siap: "selesai" }[x.status];
  el.disabled = true; await api("PATCH", "kitchen/" + encodeURIComponent(x.id), { status: next });
  x.status = next; if (next === "selesai") { S.data.kitchen = S.data.kitchen.filter(y => y !== x); toast("Pesanan " + (x.table ? "meja " + x.table : "") + " diserahkan"); }
  render();
};
actions.kprint = el => {
  const x = S.data.kitchen.find(x => x.id === el.dataset.id);
  const txt = "TIKET DAPUR\n" + (x.table ? "Meja " + x.table + "\n" : x.label ? x.label + "\n" : "") + (x.orderType || "") + "\n" + fmtDT(x.time) + "\n--------------------------------\n" + x.lines.map(i => i.qty + " x " + i.name + (i.mods ? "\n   " + modsText(i.mods) : "") + (i.note ? "\n   ! " + i.note : "")).join("\n") + "\n";
  printText(txt);
};
setInterval(async () => {
  if (!S.session || S.offline || document.hidden) return;
  const v = S.ui.view;
  try {
    if (v === "kitchen") { S.data.kitchen = (await api("GET", "kitchen?outlet=" + encodeURIComponent(S.outlet))).kitchen; if (!S.ui.modal) render(); }
    else if (v === "tables" || v === "bills") { S.data.bills = (await api("GET", "bills?outlet=" + encodeURIComponent(S.outlet))).bills; if (!S.ui.modal) render(); }
  } catch (e) {}
}, 15000);
void lsGet;
views.kitchen.load = actions.kreload;
views.tables.load = actions.billsreload;
views.bills.load = actions.billsreload;

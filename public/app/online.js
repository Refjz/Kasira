// Self-order: orders customers send from a table QR code or the shared menu link. The cashier accepts them
// into an open bill (and the kitchen) or rejects them. The owner turns it on and prints the QR codes here too.
import { S, views, actions, forms, api, toast, render, openModal, closeModal, esc, rp, modsText, me, isFnb, outletName, openExternal, SERVER } from "./core.js";

export const orderOn = () => !!(S.settings && S.settings.order && S.settings.order.enabled);
const mins = ts => Math.max(0, Math.round((Date.now() - ts) / 60000));
const where = o => o.table ? "Meja " + o.table : o.orderType || "Pesan online";

views.online = u => {
  const list = (S.data.orders || []).slice().sort((a, b) => a.time - b.time);
  return `<div class="spread"><div><h1>Pesanan online</h1><p class="muted">Pesanan dari QR meja dan link menu. Terima untuk memasukkannya ke pesanan terbuka${isFnb(S.tenant) ? " dan layar dapur" : ""}, lalu pelanggan bayar di kasir. Diperbarui tiap 15 detik.</p></div>
    <div class="row"><button class="btn" data-a="oreload">Muat ulang</button>${u.role === "owner" ? `<button class="btn" data-a="nav" data-v="settings">QR & link menu</button>` : ""}</div></div>
  ${list.length ? `<div class="ogrid">${list.map(o => `<article class="kcard${mins(o.time) >= 5 ? " late" : ""}">
    <div class="spread"><b style="font-family:var(--f-display);font-size:1.1rem">${esc(where(o))}</b><span class="pill gold num">#${esc(o.no)}</span></div>
    <div class="muted" style="font-size:.85rem">${esc(o.name)}${o.phone ? " · " + esc(o.phone) : ""} · ${mins(o.time)} mnt lalu</div>
    <ul>${o.lines.map(l => `<li><b class="num">${l.qty}×</b> ${esc(l.name)} <span class="muted num">${rp(l.price * l.qty)}</span>${l.mods ? `<div class="muted" style="font-size:.8rem">${esc(modsText(l.mods))}</div>` : ""}${l.note ? `<div style="font-size:.8rem;color:var(--warn)">${esc(l.note)}</div>` : ""}</li>`).join("")}</ul>
    ${o.note ? `<div style="font-size:.88rem"><b>Catatan:</b> ${esc(o.note)}</div>` : ""}
    <div class="spread"><span class="muted" style="font-size:.85rem">Perkiraan total</span><b class="num">${rp(o.estimate ? o.estimate.total : 0)}</b></div>
    <div class="row"><button class="btn primary" style="flex:1" data-a="oaccept" data-id="${esc(o.id)}">Terima</button><button class="btn danger" data-a="oreject" data-id="${esc(o.id)}">Tolak</button></div></article>`).join("")}</div>`
    : `<div class="panel"><p class="empty">Belum ada pesanan online yang menunggu.${me().role === "owner" ? ` Cetak QR meja atau bagikan link menu dari <button class="linkish" data-a="nav" data-v="settings">Pengaturan</button>.` : ""}</p></div>`}`;
};
views.online.load = async () => { await refresh(true); };

let seen = null;
async function refresh(force) {
  const r = await api("GET", "orders?outlet=" + encodeURIComponent(S.outlet));
  const ids = new Set(r.orders.map(o => o.id)), fresh = seen ? r.orders.filter(o => !seen.has(o.id)) : [];
  const changed = force || r.orders.length !== (S.data.orders || []).length || fresh.length;
  S.data.orders = r.orders; seen = ids;
  if (fresh.length) { toast("Pesanan online baru: " + fresh.map(o => where(o) + " · " + o.name).join(", ")); beep(); }
  if (changed && !S.ui.modal) render();
}
function beep() {
  try {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const c = new C(), o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.25);
    setTimeout(() => c.close(), 500);
  } catch (e) {}
}
setInterval(() => {
  if (!S.session || S.offline || document.hidden || !orderOn() || !S.tenant || !["trial", "paid"].includes(S.tenant.access)) return;
  refresh(false).catch(() => {});
}, 15000);

actions.oreload = () => refresh(true);
actions.oaccept = async el => {
  el.disabled = true;
  const r = await api("POST", "orders/" + encodeURIComponent(el.dataset.id) + "/accept");
  S.data.orders = S.data.orders.filter(o => o.id !== r.order.id);
  const i = S.data.bills.findIndex(b => b.id === r.bill.id); if (i >= 0) S.data.bills[i] = r.bill; else S.data.bills.push(r.bill);
  render();
  toast("Pesanan #" + r.order.no + " diterima" + (isFnb(S.tenant) && S.settings.features && S.settings.features.kitchen ? " dan dikirim ke dapur" : "") + ". Buka di " + (r.bill.table ? "Meja " + r.bill.table : "pesanan terbuka") + " untuk bayar.");
};
const REASONS = ["Menu habis", "Dapur sudah tutup", "Pesanan dobel", "Meja salah"];
actions.oreject = el => {
  const o = S.data.orders.find(x => x.id === el.dataset.id); if (!o) return;
  openModal(`<h2>Tolak pesanan #${esc(o.no)}?</h2><p class="muted" style="font-size:.9rem">Alasan tampil di HP ${esc(o.name)}.</p>
  <form class="stack" data-form="oreject" data-id="${esc(o.id)}"><div class="seg">${REASONS.map(x => `<button type="button" data-a="oreason" data-v="${esc(x)}">${esc(x)}</button>`).join("")}</div>
  <div class="field"><label for="orr">Alasan</label><input class="input" id="orr" name="reason" required placeholder="mis. Menu habis, silakan pesan yang lain"></div>
  <div class="row"><button class="btn danger" type="submit">Tolak pesanan</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`);
};
actions.oreason = el => { const i = document.getElementById("orr"); if (i) { i.value = el.dataset.v; i.focus(); } };
forms.oreject = async (d, f) => {
  await api("POST", "orders/" + encodeURIComponent(f.dataset.id) + "/reject", { reason: d.reason });
  S.data.orders = S.data.orders.filter(o => o.id !== f.dataset.id); closeModal(); toast("Pesanan ditolak");
};

/* ---------- owner settings panel ---------- */
const linkFor = (table, outlet = S.outlet) => SERVER + "/pesan/?t=" + S.settings.order.token + (outlet && outlet !== "main" ? "&o=" + encodeURIComponent(outlet) : "") + (table ? "&m=" + encodeURIComponent(table) : "");
export function orderSettingsPanel(t) {
  const o = S.settings.order || {}, fnb = isFnb(t);
  return `<form class="panel stack" data-form="setorder" id="setorder"><div class="spread"><h2>Pesan online (QR meja & link menu)</h2><span class="pill ${o.enabled ? "ok" : ""}">${o.enabled ? "aktif" : "mati"}</span></div>
    <p class="muted" style="font-size:.9rem">Pelanggan scan QR di meja${fnb ? "" : " atau buka link menu"}, pilih menu dari HP-nya sendiri, lalu pesanan masuk ke menu <b>Pesanan online</b> di kasir. Kasir menerima pesanan, lalu pelanggan bayar seperti biasa. Tanpa aplikasi tambahan, tanpa biaya per pesanan.</p>
    <label class="row" style="gap:.35rem"><input type="checkbox" name="enabled" value="1" ${o.enabled ? "checked" : ""}> Terima pesanan online</label>
    ${fnb ? `<label class="row" style="gap:.35rem"><input type="checkbox" name="takeaway" value="1" ${o.takeaway !== false ? "checked" : ""}> Terima juga pesanan tanpa meja (bawa pulang lewat link menu)</label>` : ""}
    <div><button class="btn primary" type="submit">Simpan</button></div>
    ${o.enabled && o.token ? `<div class="stack" style="gap:.6rem"><span class="label">Link menu ${S.outlets.length > 1 ? "· " + esc(outletName(S.outlet)) : ""}</span><code>${esc(linkFor(""))}</code>
      <div class="row"><button class="btn sm" type="button" data-a="olinkcopy">Salin link</button><button class="btn sm" type="button" data-a="olinkwa">Bagikan ke WhatsApp</button><button class="btn sm" type="button" data-a="olinkopen">Buka menu</button>${fnb && (S.settings.tables || []).length ? `<button class="btn sm primary" type="button" data-a="oqr">Cetak QR meja</button>` : `<button class="btn sm primary" type="button" data-a="oqr">Cetak QR</button>`}</div>
      <span class="muted" style="font-size:.8rem">Taruh link di bio Instagram, status WhatsApp, atau Google Maps. Kalau link bocor atau disalahgunakan, <button class="linkish" type="button" data-a="olinkreset">buat link baru</button> (QR lama berhenti berlaku).</span></div>` : ""}
  </form>`;
}
forms.setorder = async d => {
  const r = await api("PUT", "settings", { settings: { order: { enabled: !!d.enabled, ...(isFnb(S.tenant) ? { takeaway: !!d.takeaway } : {}) } } });
  S.settings = r.settings; render(); toast(d.enabled ? "Pesan online aktif" : "Pesan online dimatikan");
};
actions.olinkcopy = () => navigator.clipboard.writeText(linkFor("")).then(() => toast("Link menu disalin"), () => toast("Salin manual dari kotak link"));
actions.olinkwa = () => openExternal("https://wa.me/?text=" + encodeURIComponent("Pesan menu " + S.tenant.name + " langsung dari HP: " + linkFor("")));
actions.olinkopen = () => openExternal(linkFor(""));
actions.oqr = () => openExternal(SERVER + "/pesan/kartu?t=" + S.settings.order.token + (S.outlet !== "main" ? "&o=" + encodeURIComponent(S.outlet) : ""));
actions.olinkreset = () => openModal(`<h2>Buat link menu baru?</h2><p class="muted">Link dan semua QR meja yang sudah dicetak berhenti berlaku. Kamu perlu mencetak ulang QR meja.</p>
  <div class="row"><button class="btn danger" data-a="olinkresetok">Buat link baru</button><button class="btn" data-a="close">Batal</button></div>`);
actions.olinkresetok = async el => { el.disabled = true; const r = await api("POST", "order-link/reset"); S.settings = r.settings; closeModal(); toast("Link baru dibuat. Cetak ulang QR meja."); };

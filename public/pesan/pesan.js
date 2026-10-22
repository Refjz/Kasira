// Customer self-order page: /pesan/?t=<token>&o=<outlet>&m=<table>. No account needed.
// Loads the public menu, keeps the cart on the phone, sends the order to the cashier and follows its status.
const q = new URLSearchParams(location.search);
const T = (q.get("t") || "").toLowerCase(), OUTLET = q.get("o") || "", TABLE = q.get("m") || "";
const KEY = "zidny-order-" + T, PROFILE = "zidny-buyer";
const root = document.getElementById("root");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rp = n => "Rp" + Math.round(+n || 0).toLocaleString("id-ID");
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const modsText = m => m ? Object.values(m).filter(Boolean).join(", ") : "";

const S = { menu: null, error: "", cat: "", search: "", cart: [], sheet: null, pick: null, sending: false, order: null, form: { ...ls.get(PROFILE, { name: "", phone: "" }), note: "", type: "Bawa pulang" } };

async function api(method, path, body) {
  let r;
  try { r = await fetch("/api/" + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new Error("Tidak ada koneksi internet. Coba lagi."); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Gagal memproses permintaan");
  return d;
}
function toast(msg) {
  document.querySelectorAll(".toast").forEach(x => x.remove());
  const el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), 3000);
}

/* ---------- cart ---------- */
const keyOf = l => l.pid + "|" + JSON.stringify(l.mods || null) + "|" + (l.note || "");
const prod = id => S.menu.products.find(p => p.id === id);
const count = () => S.cart.reduce((s, l) => s + l.qty, 0);
const qtyOf = pid => S.cart.filter(l => l.pid === pid).reduce((s, l) => s + l.qty, 0);
function totals() {
  const sub = S.cart.reduce((s, l) => s + (prod(l.pid) || { price: 0 }).price * l.qty, 0);
  const service = Math.round(sub * (+S.menu.service || 0) / 100), tax = Math.round((sub + service) * (+S.menu.tax || 0) / 100);
  return { sub, service, tax, total: sub + service + tax };
}
function add(pid, mods, note) {
  const line = { pid, qty: 1, mods: mods || null, note: note || undefined };
  const ex = S.cart.find(l => keyOf(l) === keyOf(line));
  if (ex) ex.qty = Math.min(50, ex.qty + 1); else S.cart.push(line);
  ls.set(KEY + "-cart", S.cart);
}

/* ---------- views ---------- */
function menuView() {
  const m = S.menu, s = S.search.trim().toLowerCase();
  const prods = m.products.filter(p => !s || p.name.toLowerCase().includes(s));
  const used = [...new Set(prods.map(p => p.cat))];
  const cats = [...m.categories.filter(c => used.includes(c)), ...used.filter(c => !m.categories.includes(c))];
  const last = S.order && S.order.status === "baru" ? S.order : null;
  const head = `<header><div class="wrap"><h1>${esc(m.name)}</h1><p class="sub">${esc(m.address || m.city)}${m.outlet && m.outlet.id !== "main" ? " · " + esc(m.outlet.name) : ""}</p>
    ${TABLE ? `<span class="chip">Meja ${esc(TABLE)}</span>` : m.fnb ? `<span class="chip">Pesan dari HP</span>` : ""}</div></header>`;
  const item = p => { const n = qtyOf(p.id); return `<div class="item${p.soldOut ? " out" : ""}"><div><div class="nm">${esc(p.name)}</div><div class="pr">${rp(p.price)}</div>${p.mods ? `<div class="opt">Pilih ${esc(p.mods.map(x => x.name.toLowerCase()).join(" & "))}</div>` : ""}${p.soldOut ? `<div class="opt" style="color:var(--bad)">Habis</div>` : ""}</div>
    ${p.soldOut ? `<button class="add" disabled>Habis</button>` : n && !p.mods ? `<div class="qty"><button data-a="dec" data-id="${p.id}" aria-label="Kurangi ${esc(p.name)}">−</button><span>${n}</span><button data-a="add" data-id="${p.id}" aria-label="Tambah ${esc(p.name)}">+</button></div>`
      : `<button class="add" data-a="add" data-id="${p.id}" aria-label="Tambah ${esc(p.name)}">${n ? n + " +" : "+"}</button>`}</div>`; };
  return `${head}
  ${cats.length > 1 ? `<nav class="cats" aria-label="Kategori"><div class="wrap">${cats.map(c => `<button data-a="cat" data-v="${esc(c)}" aria-pressed="${S.cat === c}">${esc(c)}</button>`).join("")}</div></nav>` : ""}
  <main class="wrap">
    ${last ? `<button class="card" data-a="status" style="margin-top:.9rem"><span class="spread"><b>Pesanan #${esc(last.no)}</b><span class="pill"><span class="dot"></span> menunggu kasir</span></span><span class="muted" style="font-size:.85rem">Ketuk untuk lihat status</span></button>` : ""}
    ${m.products.length > 8 ? `<input class="search" type="search" id="srch" data-in="search" value="${esc(S.search)}" placeholder="Cari menu…" autocomplete="off">` : ""}
    ${cats.map(c => `<section id="cat-${esc(c)}" data-cat="${esc(c)}"><h2>${esc(c)}</h2>${prods.filter(p => p.cat === c).map(item).join("")}</section>`).join("") || `<p class="muted state">Menu tidak ditemukan.</p>`}
  </main>
  <footer class="muted wrap">Harga belum termasuk ${[m.service ? "service " + m.service + "%" : "", m.tax ? "pajak " + m.tax + "%" : ""].filter(Boolean).join(" dan ") || "promo"}. Bayar di kasir setelah pesanan dikonfirmasi.<br>Dibuat dengan <a href="/">Zidny POS</a></footer>
  ${count() ? `<div class="bar"><button data-a="checkout"><span>${count()} item · Lihat pesanan</span><span class="num">${rp(totals().total)}</span></button></div>` : ""}`;
}

function pickSheet() {
  const p = prod(S.pick.pid);
  return `<div class="spread"><h2>${esc(p.name)}</h2><b class="num">${rp(p.price)}</b></div>
    ${p.mods.map(m => `<div class="field"><span class="lbl">${esc(m.name)}</span><div class="seg">${m.opts.map(o => `<button data-a="mod" data-g="${esc(m.name)}" data-v="${esc(o)}" aria-pressed="${S.pick.mods[m.name] === o}">${esc(o)}</button>`).join("")}</div></div>`).join("")}
    ${S.menu.fnb ? `<div class="field"><label for="pn">Catatan (opsional)</label><input class="input" id="pn" data-in="picknote" value="${esc(S.pick.note)}" placeholder="mis. tanpa bawang" maxlength="120"></div>` : ""}
    <button class="btn primary" data-a="pickadd">Tambah ke pesanan</button><button class="btn" data-a="close">Batal</button>`;
}

function checkoutSheet() {
  const m = S.menu, t = totals(), f = S.form;
  return `<div class="spread"><h2>Pesananmu</h2><button class="btn" style="width:auto" data-a="close">Tutup</button></div>
    <div>${S.cart.map((l, i) => { const p = prod(l.pid) || { name: "?", price: 0 }; return `<div class="line"><div><b>${esc(p.name)}</b>${l.mods ? `<div class="muted" style="font-size:.85rem">${esc(modsText(l.mods))}</div>` : ""}${l.note ? `<div class="muted" style="font-size:.85rem">Catatan: ${esc(l.note)}</div>` : ""}<div class="num muted" style="font-size:.85rem">${rp(p.price)}</div></div>
      <div style="display:grid;gap:.3rem;justify-items:end"><b class="num">${rp(p.price * l.qty)}</b><div class="qty"><button data-a="ldec" data-i="${i}" aria-label="Kurangi">−</button><span>${l.qty}</span><button data-a="linc" data-i="${i}" aria-label="Tambah">+</button></div></div></div>`; }).join("")}</div>
    <div class="sum"><div><span class="muted">Subtotal</span><span class="num">${rp(t.sub)}</span></div>${t.service ? `<div><span class="muted">Service ${m.service}%</span><span class="num">${rp(t.service)}</span></div>` : ""}${t.tax ? `<div><span class="muted">Pajak ${m.tax}%</span><span class="num">${rp(t.tax)}</span></div>` : ""}<div class="total"><span>Perkiraan total</span><span class="num">${rp(t.total)}</span></div></div>
    <span class="muted" style="font-size:.82rem">Total akhir dihitung kasir (promo atau poin member bisa mengurangi).</span>
    ${m.fnb && !TABLE ? `<div class="field"><span class="lbl">Pesanan</span><div class="seg">${["Bawa pulang", "Makan di sini"].map(x => `<button data-a="otype" data-v="${x}" aria-pressed="${f.type === x}">${x}</button>`).join("")}</div></div>` : ""}
    <div class="field"><label for="fn">Nama kamu</label><input class="input" id="fn" data-in="name" value="${esc(f.name)}" autocomplete="name" maxlength="40" placeholder="untuk dipanggil saat pesanan siap"></div>
    <div class="field"><label for="fp">Nomor WhatsApp (opsional)</label><input class="input" id="fp" data-in="phone" value="${esc(f.phone)}" type="tel" inputmode="tel" autocomplete="tel" placeholder="08xx · supaya poin member tercatat"></div>
    <div class="field"><label for="fo">Catatan untuk kasir (opsional)</label><input class="input" id="fo" data-in="note" value="${esc(f.note)}" maxlength="200" placeholder="mis. bayar QRIS, minta sendok"></div>
    <button class="btn primary" data-a="send" ${S.sending ? "disabled" : ""}>${S.sending ? "Mengirim…" : "Kirim pesanan" + (TABLE ? " ke kasir · Meja " + esc(TABLE) : " ke kasir")}</button>`;
}

function statusView() {
  const o = S.order, m = S.menu;
  const st = o.status === "baru" ? `<span class="pill"><span class="dot"></span> Menunggu konfirmasi kasir</span>` : o.status === "diterima" ? `<span class="pill ok">✓ Pesanan diterima</span>` : `<span class="pill bad">Pesanan ditolak</span>`;
  const msg = o.status === "baru" ? "Kasir akan segera mengecek pesananmu. Halaman ini diperbarui otomatis."
    : o.status === "diterima" ? "Pesananmu sedang disiapkan. Bayar di kasir dengan menyebut nomor pesanan ini."
    : "Alasan: " + (o.reason || "-") + ". Silakan pesan lagi atau tanya kasir.";
  return `<header><div class="wrap"><h1>${esc(m ? m.name : "Pesanan")}</h1>${o.table ? `<span class="chip">Meja ${esc(o.table)}</span>` : ""}</div></header>
  <main class="wrap state"><span class="muted">Nomor pesanan</span><div class="big">#${esc(o.no)}</div>${st}<p style="max-width:34ch">${esc(msg)}</p>
    <div class="card"><b>${esc(o.name)}${o.orderType && !o.table ? " · " + esc(o.orderType) : ""}</b>${o.lines.map(l => `<div class="spread" style="font-size:.92rem"><span>${l.qty}× ${esc(l.name)}${l.mods ? `<span class="muted"> · ${esc(modsText(l.mods))}</span>` : ""}</span><span class="num">${rp(l.price * l.qty)}</span></div>`).join("")}
      <div class="spread" style="border-top:1px solid var(--line);padding-top:.4rem"><b>Perkiraan total</b><b class="num">${rp(o.estimate ? o.estimate.total : 0)}</b></div></div>
    <button class="btn ${o.status === "baru" ? "" : "primary"}" data-a="again">${o.status === "baru" ? "Kembali ke menu" : "Pesan lagi"}</button></main>`;
}

function render() {
  const a = document.activeElement, id = a && a.id, pos = a && "selectionStart" in a ? a.selectionStart : null;
  let html;
  if (S.error) html = `<div class="wrap state"><h2>Menu tidak bisa dibuka</h2><p class="muted">${esc(S.error)}</p><button class="btn" style="width:auto" data-a="retry">Coba lagi</button></div>`;
  else if (!S.menu) html = `<div class="wrap state"><p class="muted">Memuat menu…</p></div>`;
  else if (S.view === "status" && S.order) html = statusView();
  else html = menuView();
  if (S.sheet) html += `<div class="scrim" data-a="scrim"><div class="sheet" role="dialog" aria-modal="true">${S.sheet === "pick" ? pickSheet() : checkoutSheet()}</div></div>`;
  root.innerHTML = html;
  if (id) { const el = document.getElementById(id); if (el) { el.focus({ preventScroll: true }); if (pos !== null) try { el.setSelectionRange(pos, pos); } catch (e) {} } }
}

/* ---------- events ---------- */
const actions = {
  retry: () => load(),
  cat: el => { S.cat = el.dataset.v; render(); const s = document.getElementById("cat-" + el.dataset.v); if (s) window.scrollTo({ top: s.getBoundingClientRect().top + scrollY - 60, behavior: "smooth" }); },
  add: el => {
    const p = prod(el.dataset.id); if (!p || p.soldOut) return;
    if (p.mods) { S.pick = { pid: p.id, mods: Object.fromEntries(p.mods.map(m => [m.name, m.opts[0]])), note: "" }; S.sheet = "pick"; render(); return; }
    add(p.id); render();
  },
  dec: el => { const i = S.cart.findIndex(l => l.pid === el.dataset.id); if (i >= 0) { S.cart[i].qty--; if (S.cart[i].qty <= 0) S.cart.splice(i, 1); } ls.set(KEY + "-cart", S.cart); render(); },
  mod: el => { S.pick.mods[el.dataset.g] = el.dataset.v; render(); },
  pickadd: () => { add(S.pick.pid, S.pick.mods, S.pick.note.trim()); toast(prod(S.pick.pid).name + " ditambahkan"); S.sheet = null; S.pick = null; render(); },
  close: () => { S.sheet = null; render(); },
  scrim: (el, e) => { if (e.target === el) { S.sheet = null; render(); } },
  checkout: () => { S.sheet = "checkout"; render(); },
  linc: el => { const l = S.cart[+el.dataset.i]; l.qty = Math.min(50, l.qty + 1); ls.set(KEY + "-cart", S.cart); render(); },
  ldec: el => { const l = S.cart[+el.dataset.i]; l.qty--; if (l.qty <= 0) S.cart.splice(+el.dataset.i, 1); if (!S.cart.length) S.sheet = null; ls.set(KEY + "-cart", S.cart); render(); },
  otype: el => { S.form.type = el.dataset.v; render(); },
  send: async () => {
    const f = S.form;
    if (!f.name.trim()) { toast("Tulis nama kamu dulu"); const x = document.getElementById("fn"); if (x) x.focus(); return; }
    S.sending = true; render();
    try {
      const r = await api("POST", "public/order/" + T, { outlet: OUTLET || undefined, table: TABLE || undefined, name: f.name.trim(), phone: f.phone.trim() || undefined, note: f.note.trim() || undefined, orderType: S.menu.fnb && !TABLE ? f.type : undefined, lines: S.cart.map(l => ({ pid: l.pid, qty: l.qty, mods: l.mods, note: l.note })) });
      ls.set(PROFILE, { name: f.name.trim(), phone: f.phone.trim() });
      S.order = r.order; ls.set(KEY, { id: r.order.id, at: Date.now() });
      S.cart = []; ls.del(KEY + "-cart"); S.form.note = ""; S.sheet = null; S.view = "status"; window.scrollTo(0, 0); poll();
    } catch (e) { toast(e.message); if (/habis/.test(e.message)) load(); }
    finally { S.sending = false; render(); }
  },
  status: () => { S.view = "status"; window.scrollTo(0, 0); render(); poll(); },
  again: () => { if (S.order && S.order.status !== "baru") { ls.del(KEY); S.order = null; } S.view = "menu"; window.scrollTo(0, 0); render(); }
};
const inputs = {
  search: el => { S.search = el.value; render(); },
  picknote: el => { S.pick.note = el.value; },
  name: el => { S.form.name = el.value; },
  phone: el => { S.form.phone = el.value; },
  note: el => { S.form.note = el.value; }
};
root.addEventListener("click", e => { const el = e.target.closest("[data-a]"); if (el && actions[el.dataset.a]) actions[el.dataset.a](el, e); });
root.addEventListener("input", e => { const k = e.target.dataset.in; if (k && inputs[k]) inputs[k](e.target); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && S.sheet) { S.sheet = null; render(); } });

let timer = null;
function poll() {
  clearTimeout(timer);
  if (!S.order || S.order.status !== "baru") return;
  timer = setTimeout(async () => {
    try { const r = await api("GET", "public/order/" + T + "/" + encodeURIComponent(S.order.id)); const was = S.order.status; S.order = r.order; if (was !== r.order.status) { render(); if (navigator.vibrate) navigator.vibrate(200); } } catch (e) {}
    poll();
  }, 5000);
}

async function load() {
  S.error = ""; render();
  if (!/^[0-9a-f]{16}$/.test(T)) { S.error = "Link menu tidak lengkap. Scan ulang QR atau minta link terbaru ke kasir."; render(); return; }
  try {
    S.menu = await api("GET", "public/menu/" + T + (OUTLET ? "?o=" + encodeURIComponent(OUTLET) : ""));
    document.title = "Pesan · " + S.menu.name;
    if (TABLE && !S.menu.tables.includes(TABLE)) toast("Meja " + TABLE + " tidak ada di daftar. Tanya kasir.");
    const ids = new Set(S.menu.products.filter(p => !p.soldOut).map(p => p.id));
    S.cart = ls.get(KEY + "-cart", []).filter(l => ids.has(l.pid));
    if (!S.cat) S.cat = (S.menu.categories.find(c => S.menu.products.some(p => p.cat === c)) || (S.menu.products[0] || {}).cat || "");
    const saved = ls.get(KEY, null);
    if (saved && Date.now() - saved.at < 6 * 3600000 && !S.order) {
      try { S.order = (await api("GET", "public/order/" + T + "/" + encodeURIComponent(saved.id))).order; if (S.order.status === "baru") { S.view = "status"; poll(); } } catch (e) { ls.del(KEY); }
    }
  } catch (e) { S.error = e.message; }
  render();
}
load();

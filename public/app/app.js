// App shell: menu per role, outlet switcher, offline banner, sign-in flows, account, billing and the app owner console.
import { S, views, actions, forms, changes, api, toast, render, openModal, closeModal, setShell, boot, loadData, setOutlet, applyPlans, esc, rp, initials, fmtDate, daysTo,
  isFnb, isMgr, me, usable, outletName, ROLE, PLANS, TRIAL_DAYS, lsGet, lsSet, dayKey, NATIVE } from "./core.js";
import { resetPos } from "./pos.js";
import { barChart } from "./manage.js";
import { outboxPanel } from "./reports.js";
import { printerPrefs, savePrinterPrefs, pairBluetooth, hasWebBluetooth, printText } from "./print.js";

/* ---------- menu ---------- */
function menuFor(u, t) {
  if (u.role === "superadmin" && !S.session.impersonating) return [["Konsol", [["platform", "Ringkasan Platform"], ["tenants", "Pelanggan"], ["plans", "Paket Langganan"]]], ["Akun", [["account", "Akun saya"]]]];
  const fnb = isFnb(t), mgr = isMgr(u), owner = u.role === "owner";
  const sell = [mgr && ["dash", "Dasbor"], ["pos", "Kasir"], fnb && ["tables", "Meja"], fnb && ["kitchen", "Dapur"], !fnb && ["bills", "Pesanan ditahan"], ["shift", "Shift"], ["trx", u.role === "cashier" ? "Transaksi saya" : "Transaksi"]].filter(Boolean);
  const manage = mgr ? [["products", "Produk"], ["stock", "Stok"], ["customers", "Pelanggan"], ["promos", "Promo & voucher"], ["reports", "Laporan"]] : [["customers", "Pelanggan"]];
  const biz = owner ? [["staff", "Staf"], ["outlets", "Outlet"], ["settings", "Pengaturan"], ["billing", "Langganan"]] : [];
  return [["Jualan", sell], ["Kelola", manage], ...(biz.length ? [["Usaha", biz]] : []), ["Akun", [["account", "Akun saya"]]]];
}
const flat = m => m.flatMap(g => g[1]);
try { S.ui.view = sessionStorage.getItem("kasira-view") || null; } catch (e) {}
const persist = () => { try { sessionStorage.setItem("kasira-view", S.ui.view || ""); } catch (e) {} };

const backStack = [];
actions.nav = async el => {
  if (S.ui.view && S.ui.view !== el.dataset.v) { backStack.push(S.ui.view); if (backStack.length > 20) backStack.shift(); }
  S.ui.view = el.dataset.v; S.ui.modal = null; persist(); render(); window.scrollTo(0, 0);
  const f = views[S.ui.view]; if (f && f.load && !S.offline) await f.load();
};
changes.outlet = async el => { setOutlet(el.value); resetPos(); S.ui.trx = null; S.ui.trxList = null; await loadData(); render(); const f = views[S.ui.view]; if (f && f.load) await f.load(); toast("Outlet: " + outletName(el.value)); };
actions.logout = async () => { try { await api("POST", "logout"); } catch (e) {} S.session = null; S.ui = { view: null, modal: null }; auth.mode = "login"; try { localStorage.removeItem("kasira-cache-v3"); } catch (e) {} render(); };
actions.reload = () => boot({ quiet: true });
actions.impersonate = async el => { el.disabled = true; await api("POST", "admin/impersonate", { tenantId: el.dataset.id }); S.ui.view = null; resetPos(); await boot(); };
actions.unimpersonate = async () => { await api("POST", "admin/unimpersonate"); S.ui.view = "tenants"; resetPos(); await boot(); };

/* ---------- theme ---------- */
const TH = () => window.kasiraTheme;
const themeLabel = () => TH() ? TH().label() : "Otomatis", themeIcon = () => TH() ? TH().icon() : "◐";
actions.theme = () => { if (!TH()) return; const v = TH().next(); render(); toast("Tema: " + TH().label(v)); };
actions.themeset = el => { if (TH()) TH().set(el.dataset.v); render(); };
const themePanel = () => `<div class="panel stack"><h2>Tampilan</h2><div class="seg" role="group" aria-label="Tema">${[["light", "☀ Terang"], ["dark", "☾ Gelap"], ["auto", "◐ Otomatis"]].map(([k, l]) => `<button data-a="themeset" data-v="${k}" aria-pressed="${(TH() ? TH().get() : "auto") === k}">${l}</button>`).join("")}</div><span class="muted" style="font-size:.8rem">Otomatis mengikuti pengaturan gelap/terang perangkat. Tersimpan di perangkat ini.</span></div>`;

/* ---------- shell ---------- */
setShell(() => {
  const modal = S.ui.modal ? `<div class="scrim" data-a="scrim"><div class="modal" role="dialog" aria-modal="true">${S.ui.modal()}</div></div>` : "";
  if (S.booting) return `<div class="login"><p class="muted">Memuat Kasira…</p></div>`;
  const u = me();
  if (!u) return authView() + modal;
  const t = S.tenant, ok = usable(t);
  let menu = menuFor(u, t);
  if (!ok) menu = t.access === "expired" && u.role === "owner" ? [["Usaha", [["billing", "Langganan"], ["settings", "Pengaturan"]]], ["Akun", [["account", "Akun saya"]]]] : [["Akun", [["account", "Akun saya"]]]];
  const items = flat(menu);
  if (!S.ui.view || !items.some(m => m[0] === S.ui.view)) { S.ui.view = items[0][0]; persist(); }
  let body;
  if (t && t.access === "suspended") body = `<div class="blocked panel"><h2>Akun ${esc(t.name)} sedang ditangguhkan</h2><p class="muted">Pemilik aplikasi menangguhkan langganan usaha ini. Kasir dan laporan tidak bisa dipakai sampai akun diaktifkan kembali.</p><div><button class="btn" data-a="logout">Keluar</button></div></div>`;
  else if (t && !ok && u.role !== "owner" && S.ui.view !== "account") body = `<div class="blocked panel"><h2>Masa coba ${esc(t.name)} sudah habis</h2><p class="muted">Kasir terkunci sampai pemilik usaha membayar langganan. Hubungi pemilik usahamu.</p><div><button class="btn" data-a="logout">Keluar</button></div></div>`;
  else body = (views[S.ui.view] || (() => ""))(u, t);
  let bar = "";
  if (S.offline) bar += `<div class="trial-bar bad"><span><b>Sedang offline.</b> <span class="muted">Kasir tetap bisa menjual tunai. Transaksi tersimpan di perangkat ini dan dikirim otomatis saat internet kembali.</span></span></div>`;
  if (t && t.access === "trial") bar += `<div class="trial-bar"><span><b>Masa coba gratis: sisa ${t.daysLeft} hari.</b> <span class="muted">Berakhir ${fmtDate(t.trialEnds)}. Setelah itu wajib berlangganan.</span></span>${u.role === "owner" && S.ui.view !== "billing" ? `<button class="btn sm primary" data-a="nav" data-v="billing">Pilih paket</button>` : ""}</div>`;
  if (t && t.access === "expired" && u.role === "owner") bar += `<div class="trial-bar bad"><span><b>Masa coba atau langganan sudah habis.</b> <span class="muted">Bayar langganan untuk membuka kembali kasir, produk, dan laporan. Data usahamu tetap tersimpan.</span></span></div>`;
  const switcher = t && ok && isMgr(u) && S.outlets.length > 1 ? `<select class="input" data-ch="outlet" aria-label="Pilih outlet" style="font-weight:600">${S.outlets.map(o => `<option value="${o.id}" ${o.id === S.outlet ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>` : "";
  return `<div class="app">
    <aside class="side">
      <div class="brand"><i aria-hidden="true"></i>Kasira</div>
      ${t ? `<div class="tenant-chip"><div class="label">Usaha</div><div style="font-weight:700">${esc(t.name)}</div><div class="muted" style="font-size:.8rem">${esc(t.type)} · ${t.access === "trial" ? "Coba gratis" : t.access === "paid" ? "Paket " + PLANS[t.plan].name : "Tidak aktif"}</div>${S.outlets.length > 1 && !isMgr(u) ? `<div class="muted" style="font-size:.8rem">${esc(outletName(S.outlet))}</div>` : ""}</div>`
        : `<div class="tenant-chip"><div class="label">Konsol</div><div style="font-weight:700">Pemilik Aplikasi</div><div class="muted" style="font-size:.8rem">${S.admin.tenants.length} usaha terdaftar</div></div>`}
      ${switcher}
      <nav class="nav" aria-label="Menu">${menu.map(([g, list]) => `<div class="nav-group"><span class="label">${g}</span>${list.map(([k, l]) => `<button data-a="nav" data-v="${k}" ${S.ui.view === k ? 'aria-current="page"' : ""}>${l}${k === "kitchen" && S.data.kitchen.filter(x => x.status === "baru").length ? ` <span class="pill gold">${S.data.kitchen.filter(x => x.status === "baru").length}</span>` : ""}</button>`).join("")}</div>`).join("")}</nav>
      <div class="side-foot">
        ${S.offline ? `<span class="pill bad">offline</span>` : ""}
        ${S.session.impersonating ? `<button class="btn sm" data-a="unimpersonate">Kembali ke konsol</button>` : ""}
        <div class="row who"><span class="avatar">${initials(u.name)}</span><div><div style="font-weight:600;font-size:.9rem">${esc(u.name)}</div><div class="muted" style="font-size:.78rem">${ROLE[u.role]}</div></div></div>
        <div class="row" style="gap:.4rem;flex-wrap:nowrap"><button class="btn sm theme-btn" data-a="theme" title="Tema: ${themeLabel()}" aria-label="Ganti tema (sekarang ${themeLabel()})">${themeIcon()}</button><button class="btn sm" data-a="logout">Keluar</button></div>
      </div>
    </aside>
    <main class="main"><div class="main-inner">${bar}${body}</div></main>
  </div>${modal}`;
});

/* ---------- sign in, sign up, forgot and reset password ---------- */
const auth = { mode: "login", token: "", sent: null };
function readHash() {
  const h = location.hash;
  if (h.startsWith("#reset=")) { auth.mode = "reset"; auth.token = h.slice(7); }
  else auth.mode = ({ "#daftar": "signup", "#setup": "setup", "#lupa": "forgot" })[h] || "login";
}
readHash();
const setHash = h => history.replaceState(null, "", location.pathname + h);
actions.auth = el => { auth.mode = el.dataset.v; auth.sent = null; setHash({ signup: "#daftar", setup: "#setup", forgot: "#lupa" }[auth.mode] || ""); render(); const f = document.querySelector(".login-side input"); if (f) f.focus(); };
function authView() {
  const m = auth.mode;
  const tabs = ["login", "signup"].includes(m) ? `<div class="seg" role="group" aria-label="Masuk atau daftar"><button data-a="auth" data-v="login" aria-pressed="${m === "login"}">Masuk</button><button data-a="auth" data-v="signup" aria-pressed="${m === "signup"}">Daftar gratis</button></div>` : "";
  const back = `<p class="muted" style="font-size:.88rem"><button class="linkish" data-a="auth" data-v="login">Kembali ke halaman masuk</button></p>`;
  const F = {
    login: `<div><h2>Masuk ke Kasira</h2><p class="muted" style="font-size:.9rem">Untuk pemilik usaha, manajer, dan kasir.</p></div>
      <form class="stack" data-form="login">
        <div class="field"><label for="le">Email</label><input class="input" id="le" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="lp">Kata sandi</label><input class="input" id="lp" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn primary" type="submit">Masuk</button></form>
      <p class="muted" style="font-size:.88rem"><button class="linkish" data-a="auth" data-v="forgot">Lupa kata sandi?</button></p>
      <p class="muted" style="font-size:.88rem">Belum punya akun? <button class="linkish" data-a="auth" data-v="signup">Daftar dan coba gratis ${TRIAL_DAYS} hari</button></p>`,
    signup: `<div><h2>Coba gratis ${TRIAL_DAYS} hari</h2><p class="muted" style="font-size:.9rem">Semua fitur tanpa batas selama ${TRIAL_DAYS} hari, tanpa kartu kredit. Setelah itu pilih paket bulanan atau tahunan.</p></div>
      <form class="stack" data-form="signup">
        <div class="field"><label for="sn1">Nama kamu</label><input class="input" id="sn1" name="name" autocomplete="name" required></div>
        <div class="field"><label for="sb1">Nama usaha</label><input class="input" id="sb1" name="business" required placeholder="mis. Warung Makan Bu Tini"></div>
        <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="st1">Jenis usaha</label><select class="input" id="st1" name="type"><option>F&amp;B</option><option>Minimarket</option><option>Retail</option><option>Jasa</option></select></div>
        <div class="field" style="flex:1"><label for="sc1">Kota</label><input class="input" id="sc1" name="city" required></div></div>
        <div class="field"><label for="se1">Email</label><input class="input" id="se1" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="sp1">Kata sandi</label><input class="input" id="sp1" name="password" type="password" autocomplete="new-password" minlength="8" required><span class="muted" style="font-size:.8rem">Minimal 8 karakter.</span></div>
        <button class="btn primary" type="submit">Mulai coba gratis</button></form>
      <p class="muted" style="font-size:.88rem">Sudah punya akun? <button class="linkish" data-a="auth" data-v="login">Masuk</button></p>`,
    forgot: auth.sent ? `<div><h2>Cek email kamu</h2><p class="muted" style="font-size:.92rem">${auth.sent.mail ? `Kalau <b>${esc(auth.sent.email)}</b> terdaftar, tautan untuk membuat kata sandi baru sudah dikirim. Tautan berlaku 2 jam. Cek juga folder spam.` : `Pengiriman email belum diaktifkan di Kasira. Hubungi pemilik usahamu (untuk staf) atau admin Kasira via WhatsApp (untuk pemilik usaha) agar dibuatkan tautan atur ulang kata sandi.`}</p></div>${back}`
      : `<div><h2>Lupa kata sandi</h2><p class="muted" style="font-size:.9rem">Masukkan email akunmu. Kami kirim tautan untuk membuat kata sandi baru. Staf juga bisa minta pemilik usaha mengganti kata sandinya di menu Staf.</p></div>
      <form class="stack" data-form="forgot"><div class="field"><label for="fe">Email</label><input class="input" id="fe" name="email" type="email" autocomplete="username" required></div><button class="btn primary" type="submit">Kirim tautan</button></form>${back}`,
    reset: `<div><h2>Buat kata sandi baru</h2><p class="muted" style="font-size:.9rem">Setelah disimpan, kamu langsung masuk dan semua perangkat lain keluar otomatis.</p></div>
      <form class="stack" data-form="reset-pass"><div class="field"><label for="rp1">Kata sandi baru</label><input class="input" id="rp1" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="field"><label for="rp2">Ulangi kata sandi</label><input class="input" id="rp2" name="password2" type="password" autocomplete="new-password" minlength="8" required></div><button class="btn primary" type="submit">Simpan & masuk</button></form>${back}`,
    setup: `<div><h2>Aktivasi Pemilik Aplikasi</h2><p class="muted" style="font-size:.9rem">Sekali pakai. Hanya email pemilik aplikasi yang tersimpan di server yang bisa diaktifkan di sini.</p></div>
      <form class="stack" data-form="setup">
        <div class="field"><label for="on1">Nama</label><input class="input" id="on1" name="name" autocomplete="name" required></div>
        <div class="field"><label for="oe1">Email pemilik aplikasi</label><input class="input" id="oe1" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="op1">Kata sandi baru</label><input class="input" id="op1" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="field"><label for="op2">Ulangi kata sandi</label><input class="input" id="op2" name="password2" type="password" autocomplete="new-password" minlength="8" required></div>
        <button class="btn primary" type="submit">Aktifkan akun pemilik</button></form>${back}`
  };
  return `<div class="login"><div class="login-card">
    <div class="login-hero">
      <div class="stack">${NATIVE ? "" : `<a href="../" class="label" style="color:inherit;opacity:.85">← Beranda Kasira</a>`}<h1>Kasira</h1><p style="font-size:1.05rem;max-width:34ch">Aplikasi kasir untuk minimarket dan F&amp;B. Tetap jalan saat internet putus.</p></div>
      <ul><li>Meja, open bill, split bill, layar dapur, resep bahan baku</li><li>Scan barcode pakai kamera HP, satuan pcs/pak/dus, harga grosir</li><li>QRIS otomatis, struk Bluetooth & WhatsApp</li><li>Shift kasir, refund dengan PIN manajer</li><li>Member, poin, promo, voucher, multi-outlet</li><li>Laporan lengkap & ekspor Excel</li><li>Gratis ${TRIAL_DAYS} hari, lalu ${rp(PLANS.bulanan.price)}/bulan atau ${rp(PLANS.tahunan.price)}/tahun</li></ul>
    </div>
    <div class="login-side"><div class="spread">${tabs || "<span></span>"}<button class="btn sm theme-btn" data-a="theme" aria-label="Ganti tema (sekarang ${themeLabel()})" title="Tema: ${themeLabel()}">${themeIcon()}</button></div>${F[m] || F.login}</div>
  </div></div>`;
}
forms.login = async d => { await api("POST", "login", { email: d.email, password: d.password }); S.ui.view = null; await boot(); };
forms.signup = async d => { await api("POST", "signup", d); setHash(""); S.ui.view = "dash"; await boot(); toast("Selamat datang! Masa coba " + TRIAL_DAYS + " hari dimulai."); };
forms.setup = async d => { if (d.password !== d.password2) { toast("Kedua kata sandi tidak sama"); return; } await api("POST", "setup-owner", { name: d.name, email: d.email, password: d.password }); setHash(""); S.ui.view = null; await boot(); toast("Akun Pemilik Aplikasi aktif"); };
forms.forgot = async d => { const r = await api("POST", "password/forgot", { email: d.email }); auth.sent = { email: d.email, mail: r.mail }; render(); };
forms["reset-pass"] = async d => { if (d.password !== d.password2) { toast("Kedua kata sandi tidak sama"); return; } await api("POST", "password/reset", { token: auth.token, password: d.password }); auth.mode = "login"; setHash(""); S.ui.view = null; await boot(); toast("Kata sandi baru tersimpan"); };

/* ---------- account ---------- */
views.account = u => {
  const pp = printerPrefs(), mgr = isMgr(u) && u.role !== "superadmin", self = S.staff.find(s => s.id === u.id) || u;
  return `<div><h1>Akun saya</h1><p class="muted">${esc(u.name)} · ${esc(u.email)} · ${ROLE[u.role]}</p></div>
  <div class="grid-2"><form class="panel stack" data-form="chpass"><h2>Ganti kata sandi</h2>
    <div class="field"><label for="cp0">Kata sandi sekarang</label><input class="input" id="cp0" name="old" type="password" autocomplete="current-password" required></div>
    <div class="field"><label for="cp1">Kata sandi baru</label><input class="input" id="cp1" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
    <div class="field"><label for="cp2">Ulangi kata sandi baru</label><input class="input" id="cp2" name="password2" type="password" autocomplete="new-password" minlength="8" required></div>
    <span class="muted" style="font-size:.8rem">Perangkat lain yang memakai akun ini akan keluar otomatis.</span>
    <div><button class="btn primary" type="submit">Simpan kata sandi</button></div></form>
  ${mgr ? `<form class="panel stack" data-form="setpin"><div class="spread"><h2>PIN persetujuan</h2><span class="pill ${self.hasPin ? "ok" : "gold"}">${self.hasPin ? "sudah diatur" : "belum diatur"}</span></div>
    <p class="muted" style="font-size:.9rem">PIN 6 angka dipakai untuk menyetujui refund, pembatalan transaksi, dan pengurangan pesanan yang sudah masuk dapur. Kasir meminta kamu mengetikkan PIN di perangkat kasir.</p>
    <div class="field"><label for="pn1">PIN baru (6 angka)</label><input class="input num" id="pn1" name="pin" type="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="off" required></div>
    <div class="field"><label for="pn2">Kata sandi akun</label><input class="input" id="pn2" name="password" type="password" autocomplete="current-password" required></div>
    <div><button class="btn primary" type="submit">Simpan PIN</button></div></form>` : ""}</div>
  ${u.role !== "superadmin" || S.session.impersonating ? `<form class="panel stack" data-form="printer"><div class="spread"><h2>Printer struk</h2>${pp.btName ? `<span class="pill ok">${esc(pp.btName)}</span>` : ""}</div>
    <p class="muted" style="font-size:.9rem">Pengaturan ini tersimpan di perangkat ini saja.</p>
    <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:2"><label for="prm">Cara cetak</label><select class="input" id="prm" name="mode">
      <option value="browser" ${pp.mode === "browser" ? "selected" : ""}>Dialog cetak (printer USB/WiFi, simpan PDF)</option>
      <option value="bluetooth" ${pp.mode === "bluetooth" ? "selected" : ""}>Printer Bluetooth langsung${hasWebBluetooth() ? "" : " (tidak didukung browser ini)"}</option>
      <option value="rawbt" ${pp.mode === "rawbt" ? "selected" : ""}>Aplikasi RawBT (Android, semua printer thermal)</option></select></div>
      <div class="field" style="flex:1"><label for="prp">Kertas</label><select class="input" id="prp" name="paper"><option value="58" ${+pp.paper === 58 ? "selected" : ""}>58 mm</option><option value="80" ${+pp.paper === 80 ? "selected" : ""}>80 mm</option></select></div></div>
    <label class="row" style="gap:.35rem"><input type="checkbox" name="auto" value="1" ${pp.auto ? "checked" : ""}> Cetak struk otomatis setelah pembayaran</label>
    <div class="row"><button class="btn primary" type="submit">Simpan</button><button class="btn" type="button" data-a="btpair">Sambungkan printer Bluetooth</button><button class="btn" type="button" data-a="testprint">Cetak tes</button></div>
    <span class="muted" style="font-size:.8rem">Bluetooth langsung butuh Chrome di Android atau laptop. Di aplikasi Android Kasira, pakai mode RawBT dan pasang aplikasi RawBT dari Play Store.</span></form>` : ""}
  ${themePanel()}
  ${outboxPanel()}`;
};
forms.chpass = async (d, f) => { if (d.password !== d.password2) { toast("Kedua kata sandi baru tidak sama"); return; } await api("POST", "password/change", { old: d.old, password: d.password }); f.reset(); toast("Kata sandi diganti"); };
forms.setpin = async (d, f) => { await api("POST", "pin", { pin: d.pin, password: d.password }); const s = S.staff.find(s => s.id === me().id); if (s) s.hasPin = true; f.reset(); render(); toast("PIN tersimpan"); };
forms.printer = d => { savePrinterPrefs({ mode: d.mode, paper: +d.paper, auto: !!d.auto }); render(); toast("Pengaturan printer disimpan"); };
actions.btpair = async () => { if (!hasWebBluetooth()) { toast("Browser ini tidak mendukung Bluetooth. Pakai Chrome atau mode RawBT."); return; } await pairBluetooth(); savePrinterPrefs({ mode: "bluetooth" }); render(); };
actions.testprint = () => printText("KASIRA\nTes printer\n" + new Date().toLocaleString("id-ID") + "\n--------------------------------\nKalau tulisan ini rapi,\nprinter siap dipakai.\n");

/* ---------- billing ---------- */
views.billing = (u, t) => {
  const status = t.access === "trial" ? `Masa coba gratis berakhir ${fmtDate(t.trialEnds)} (sisa ${t.daysLeft} hari). Setelah itu kasir terkunci sampai langganan dibayar.`
    : t.access === "paid" ? `Paket ${PLANS[t.plan].name} aktif sampai ${fmtDate(t.paidUntil)}.` : `Masa coba atau langganan sudah habis. Pilih paket dan bayar untuk membuka kembali kasir.`;
  const pr = t.payRequest;
  return `<div><h1>Langganan</h1><p class="muted">${status}</p></div>
  ${pr ? `<div class="panel stack" style="border-color:var(--gold)"><div class="spread"><h2>Menunggu pembayaran</h2><span class="pill gold">diproses</span></div><p>Paket <b>${PLANS[pr.plan].name}</b>, 1 ${PLANS[pr.plan].per}, <b class="num">${rp(pr.amount)}</b>. Diajukan ${fmtDate(pr.at)}.</p>
    ${pr.redirect ? `<p class="muted" style="font-size:.9rem">Bayar lewat QRIS, e-wallet, virtual account, atau kartu. Langganan aktif otomatis begitu pembayaran berhasil.</p><div class="row"><a class="btn primary" href="${esc(pr.redirect)}" target="_blank" rel="noopener">Lanjutkan pembayaran</a><button class="btn" data-a="paycheck">Saya sudah bayar, cek status</button></div>`
      : `<p class="muted" style="font-size:.9rem">Tim Kasira akan mengirim instruksi pembayaran ke <b>${esc(u.email)}</b>. Langganan aktif begitu pembayaran dikonfirmasi.</p>`}</div>` : ""}
  <div class="plans">${Object.entries(PLANS).map(([k, p]) => { const cur = t.access === "paid" && t.plan === k; return `<div class="panel plan${cur ? " current" : ""}"><div class="spread"><h2>${p.name}</h2>${cur ? '<span class="pill ok">aktif</span>' : ""}</div><div><span class="num" style="font-size:1.4rem;font-weight:700">${rp(p.price)}</span><span class="muted"> /${p.per}</span>${p.note ? ` <span class="pill ok">${p.note}</span>` : ""}</div><ul>${p.feat.map(f => `<li>${f}</li>`).join("")}</ul><button class="btn ${k === "tahunan" ? "primary" : ""}" data-a="payplan" data-v="${k}">${cur ? "Perpanjang" : "Bayar paket " + p.name}</button></div>`; }).join("")}</div>`;
};
actions.payplan = async el => {
  el.disabled = true;
  const w = NATIVE ? null : window.open("", "_blank");
  const r = await api("POST", "billing/request", { plan: el.dataset.v });
  S.tenant.payRequest = r.payRequest; render();
  if (r.redirect) { if (w) w.location = r.redirect; else location.href = r.redirect; }
  else { if (w) w.close(); toast("Permintaan pembayaran paket " + PLANS[el.dataset.v].name + " terkirim"); }
};
actions.paycheck = async el => {
  el.disabled = true; const r = await api("GET", "billing/status");
  if (r.status === "settlement") { toast("Pembayaran diterima. Terima kasih!"); await boot({ quiet: true }); }
  else { S.tenant = { ...S.tenant, ...r.tenant }; render(); toast(r.status === "pending" || !r.status ? "Pembayaran belum diterima" : "Pembayaran " + r.status + ". Coba bayar lagi."); }
};

/* ---------- app owner console ---------- */
const trxOf = tid => S.admin.transactions.filter(x => x.tenantId === tid);
function accessPill(t) {
  if (t.access === "trial") return `<span class="pill gold">coba · ${t.daysLeft} hari</span>`;
  if (t.access === "paid") return `<span class="pill ok">aktif s/d ${new Date(t.paidUntil).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</span>`;
  if (t.access === "expired") return `<span class="pill bad">habis</span>`;
  return `<span class="pill bad">ditangguhkan</span>`;
}
const putTenant = nt => { const i = S.admin.tenants.findIndex(x => x.id === nt.id); if (i >= 0) S.admin.tenants[i] = { ...S.admin.tenants[i], ...nt }; };
function last7(list) { const days = []; for (let d = 6; d >= 0; d--) { const dt = new Date(Date.now() - d * 86400000); days.push({ key: dayKey(dt), label: dt.toLocaleDateString("id-ID", { weekday: "short" }), v: 0, hi: d === 0 }); } for (const x of list) { const d = days.find(a => a.key === dayKey(x.time)); if (d) d.v += x.total; } return days; }
views.platform = () => {
  const ts = S.admin.tenants, paid = ts.filter(t => t.access === "paid"), trial = ts.filter(t => t.access === "trial");
  const mrr = paid.reduce((s, t) => s + PLANS[t.plan].monthly, 0), gmv = S.admin.transactions.reduce((s, x) => s + x.total, 0), waiting = ts.filter(t => t.payRequest).length;
  const per = ts.map(t => ({ t, v: trxOf(t.id).reduce((s, x) => s + x.total, 0) })).sort((a, b) => b.v - a.v).slice(0, 8), mx = per[0] ? per[0].v || 1 : 1;
  return `<div><div class="label">Konsol Pemilik Aplikasi</div><h1>Ringkasan Platform</h1></div>
  <div class="tiles">
    <div class="tile"><span class="label">Usaha terdaftar</span><span class="v">${ts.length}</span><span class="d muted">${paid.length} berbayar · ${trial.length} masa coba</span></div>
    <div class="tile"><span class="label">Pendapatan langganan / bulan</span><span class="v">${rp(mrr)}</span><span class="d muted">MRR (tahunan dihitung per bulan)</span></div>
    <div class="tile"><span class="label">Nilai transaksi 7 hari</span><span class="v">${rp(gmv)}</span><span class="d muted">GMV semua usaha</span></div>
    <div class="tile"><span class="label">Menunggu pembayaran</span><span class="v">${waiting}</span><span class="d muted">${waiting ? '<button class="linkish" data-a="nav" data-v="tenants">lihat pelanggan</button>' : "tidak ada"}</span></div></div>
  <div class="grid-2"><div class="panel stack"><h2>Nilai transaksi seluruh platform</h2>${barChart(last7(S.admin.transactions))}</div>
    <div class="panel stack"><h2>Usaha paling aktif</h2>${per.length ? per.map(({ t, v }) => `<div class="stack" style="gap:.25rem"><div class="spread"><span>${esc(t.name)}</span><span class="num muted">${rp(v)}</span></div><div class="bar-meter"><i style="width:${v / mx * 100}%"></i></div></div>`).join("") : '<p class="muted">Belum ada usaha terdaftar.</p>'}</div></div>`;
};
views.tenants = () => `<div class="spread"><div><h1>Pelanggan</h1><p class="muted">Usaha mendaftar sendiri dan mendapat masa coba ${TRIAL_DAYS} hari. Perpanjang masa coba, aktifkan langganan, atau buat tautan ganti kata sandi dari tombol "Atur akun".</p></div><button class="btn" data-a="reload">Muat ulang</button></div>
  <div class="panel tbl-wrap"><table><thead><tr><th>Usaha</th><th>Jenis</th><th>Status</th><th>Permintaan bayar</th><th class="r">Akun</th><th class="r">Transaksi 7 hari</th><th></th></tr></thead><tbody>
  ${S.admin.tenants.map(t => { const tr = trxOf(t.id); return `<tr><td><b>${esc(t.name)}</b><div class="muted" style="font-size:.8rem">${t.owner ? esc(t.owner.name) + " · " + esc(t.owner.email) : ""}<br>${esc(t.city)} · daftar ${new Date(t.joined).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</div></td><td>${esc(t.type)}</td><td>${accessPill(t)}${t.access === "paid" ? ` <span class="pill">${PLANS[t.plan].name}</span>` : ""}</td>
  <td>${t.payRequest ? `<span class="pill gold">${PLANS[t.payRequest.plan].name} · ${rp(t.payRequest.amount)}</span>` : '<span class="muted">–</span>'}</td><td class="r num">${t.users}</td><td class="r num">${tr.length} · ${rp(tr.reduce((s, x) => s + x.total, 0))}</td>
  <td class="r" style="white-space:nowrap"><button class="btn sm primary" data-a="extend" data-id="${t.id}">Atur akun</button> <button class="btn sm" data-a="impersonate" data-id="${t.id}">Masuk sebagai pemilik</button> <button class="btn sm ${t.status === "aktif" ? "danger" : ""}" data-a="togglet" data-id="${t.id}">${t.status === "aktif" ? "Tangguhkan" : "Pulihkan"}</button></td></tr>`; }).join("") || `<tr><td colspan="7" class="empty">Belum ada usaha yang mendaftar.</td></tr>`}
  </tbody></table></div>`;
views.tenants.load = async () => { S.admin = await api("GET", "admin/tenants"); render(); };
views.platform.load = views.tenants.load;
function extendModal(t) {
  const pr = t.payRequest;
  return () => `<div class="spread"><h2>Atur akun ${esc(t.name)}</h2><button class="btn sm" data-a="close">Tutup</button></div>
  <p class="muted" style="font-size:.9rem">Status sekarang: ${accessPill(t)}${t.access === "trial" ? " sampai " + fmtDate(t.trialEnds) : t.access === "paid" ? " sampai " + fmtDate(t.paidUntil) : ""}</p>
  <form class="panel stack" data-form="trial" data-id="${t.id}"><h3>Perpanjang masa coba</h3>
    <div class="field"><label for="xt">Tambah hari</label><input class="input" id="xt" name="days" type="number" min="1" max="365" value="7" required></div>
    <span class="muted" style="font-size:.8rem">Dihitung dari akhir masa coba, atau dari hari ini kalau sudah habis.</span><div><button class="btn" type="submit">Perpanjang masa coba</button></div></form>
  <form class="panel stack" data-form="extend" data-id="${t.id}"><h3>Jadikan pelanggan berbayar</h3>
    <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="xp">Paket</label><select class="input" id="xp" name="plan">${Object.entries(PLANS).map(([k, p]) => `<option value="${k}" ${(pr ? pr.plan : t.plan) === k ? "selected" : ""}>${p.name} · ${rp(p.price)}/${p.per}</option>`).join("")}</select></div>
    <div class="field" style="width:110px"><label for="xn">Jumlah</label><input class="input" id="xn" name="periods" type="number" min="1" max="36" value="1" required></div></div>
    <span class="muted" style="font-size:.8rem">Jumlah bulan atau tahun sesuai paket. Ditambahkan dari akhir langganan yang masih berjalan.</span>
    <div class="row"><button class="btn primary" type="submit">Aktifkan langganan</button>${t.access === "paid" ? `<button class="btn danger" type="button" data-a="endsub" data-id="${t.id}">Hentikan langganan</button>` : ""}</div></form>
  <div class="panel stack"><h3>Pemilik lupa kata sandi</h3><p class="muted" style="font-size:.85rem">Buat tautan sekali pakai (berlaku 24 jam) lalu kirim ke pemilik usaha lewat WhatsApp.</p>
    ${S.ui.resetLink && S.ui.resetLink.id === t.id ? `<div class="receipt" style="word-break:break-all">${esc(S.ui.resetLink.link)}</div><div class="row"><button class="btn sm" data-a="copylink">Salin</button></div>` : `<div><button class="btn" data-a="resetlink" data-id="${t.id}">Buat tautan ganti kata sandi</button></div>`}</div>`;
}
actions.extend = el => { S.ui.resetLink = null; openModal(extendModal(S.admin.tenants.find(x => x.id === el.dataset.id))); };
actions.resetlink = async el => { el.disabled = true; const r = await api("POST", "admin/reset-link", { tenantId: el.dataset.id }); S.ui.resetLink = { id: el.dataset.id, link: r.link }; render(); };
actions.copylink = () => navigator.clipboard.writeText(S.ui.resetLink.link).then(() => toast("Tautan disalin"), () => toast("Salin manual dari kotak di atas"));
actions.endsub = async el => { el.disabled = true; const r = await api("POST", "admin/tenants/" + encodeURIComponent(el.dataset.id), { action: "endsub" }); putTenant(r.tenant); closeModal(); toast("Langganan " + r.tenant.name + " dihentikan"); };
actions.togglet = async el => { const x = S.admin.tenants.find(x => x.id === el.dataset.id); el.disabled = true; const r = await api("POST", "admin/tenants/" + encodeURIComponent(x.id), { action: x.status === "aktif" ? "suspend" : "activate" }); putTenant(r.tenant); render(); toast(x.name + " " + (r.tenant.status === "aktif" ? "dipulihkan" : "ditangguhkan")); };
forms.extend = async (d, f) => { const r = await api("POST", "admin/tenants/" + encodeURIComponent(f.dataset.id), { action: "extend", plan: d.plan, periods: +d.periods }); putTenant(r.tenant); closeModal(); toast(r.tenant.name + " berlangganan sampai " + fmtDate(r.tenant.paidUntil)); };
forms.trial = async (d, f) => { const r = await api("POST", "admin/tenants/" + encodeURIComponent(f.dataset.id), { action: "trial", days: +d.days }); putTenant(r.tenant); closeModal(); toast("Masa coba " + r.tenant.name + " sampai " + fmtDate(r.tenant.trialEnds)); };
views.plans = () => {
  const count = k => S.admin.tenants.filter(t => t.access === "paid" && t.plan === k).length;
  return `<div><h1>Paket Langganan</h1><p class="muted">Semua paket berisi semua fitur tanpa batas. Usaha baru gratis selama ${TRIAL_DAYS} hari, setelah itu wajib berlangganan bulanan atau tahunan. Saat ini ${S.admin.tenants.filter(t => t.access === "trial").length} usaha dalam masa coba.</p></div>
  <div class="plans">${Object.entries(PLANS).map(([k, p]) => `<div class="panel plan"><div class="spread"><h2>${p.name}</h2><span class="pill">${count(k)} usaha</span></div><div><span class="num" style="font-size:1.4rem;font-weight:700">${rp(p.price)}</span><span class="muted"> /${p.per}</span>${p.note ? ` <span class="pill ok">${p.note}</span>` : ""}</div><ul>${p.feat.map(f => `<li>${f}</li>`).join("")}</ul></div>`).join("")}</div>
  <form class="panel stack" data-form="plans"><h2>Atur harga</h2><p class="muted" style="font-size:.9rem">Harga baru langsung berlaku untuk tagihan berikutnya, halaman Langganan pemilik usaha, dan halaman depan. Langganan yang sudah berjalan tidak berubah.</p>
    <div class="row" style="flex-wrap:nowrap">${Object.entries(PLANS).map(([k, p]) => `<div class="field" style="flex:1"><label for="pl_${k}">Harga ${p.name} (Rp per ${p.per})</label><input class="input num" id="pl_${k}" name="${k}" type="number" min="1000" step="1000" required value="${p.price}"></div>`).join("")}</div>
    <div><button class="btn primary" type="submit">Simpan harga</button></div></form>`;
};
forms.plans = async d => {
  const r = await api("PUT", "admin/plans", { plans: Object.fromEntries(Object.keys(PLANS).map(k => [k, { price: +d[k] }])) });
  applyPlans(r.plans); render(); toast("Harga paket disimpan");
};

/* ---------- start ---------- */
window.addEventListener("hashchange", () => { if (!S.session) { readHash(); render(); } });
// Android back button: close the open window, then go back through visited screens, then send the app to the background.
const AppPlugin = NATIVE && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
if (AppPlugin) AppPlugin.addListener("backButton", async () => {
  if (S.ui.modal) return closeModal();
  const prev = backStack.pop();
  if (prev && S.session) { S.ui.view = prev; persist(); render(); window.scrollTo(0, 0); const f = views[prev]; if (f && f.load && !S.offline) await f.load(); return; }
  AppPlugin.minimizeApp();
});
if (!NATIVE && "serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
api("GET", "plans").then(r => { applyPlans(r.plans); if (!S.session) render(); }).catch(() => {});
if (auth.mode === "reset") { S.booting = false; render(); } else await boot();
{ const f = views[S.ui.view]; if (S.session && f && f.load && !S.offline) f.load().catch(e => toast(e.message)); }
void [lsGet, lsSet, daysTo, closeModal];

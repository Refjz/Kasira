// Bookkeeping: operating expenses, profit & loss (net profit after expenses) and the UMKM final tax estimate.
import { S, views, actions, forms, changes, api, toast, render, openModal, closeModal, esc, rp, nf, uid, fmtDate, isoDay, me, outletName, METHODS } from "./core.js";
import { EXPENSE_CATS, TAX_MODES, TAX_FREE, taxMode, umkmTax } from "./books.js";
import { preset, rangeBar, outletSel, applyRange, startOf, endOf } from "./reports.js";

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const BS = () => S.ui.books || (S.ui.books = { tab: "exp", preset: "month", from: preset("month")[0], to: preset("month")[1], outlet: "all", list: null, rep: null, year: new Date().getFullYear(), tax: null });

views.books = () => {
  const st = BS();
  const tabs = [["exp", "Pengeluaran"], ["pl", "Laba rugi"], ["tax", "Pajak UMKM"]];
  const body = st.tab === "exp" ? expTab(st) : st.tab === "pl" ? plTab(st) : taxTab(st);
  return `<div class="spread"><div><h1>Pembukuan</h1><p class="muted">Catat pengeluaran usaha, lihat laba bersih, dan perkiraan pajak UMKM 0,5% tanpa hitung manual.</p></div>${st.tab === "exp" ? `<button class="btn primary" data-a="expnew">Catat pengeluaran</button>` : ""}</div>
  <div class="seg" role="tablist" aria-label="Pembukuan">${tabs.map(([k, l]) => `<button data-a="bktab" data-v="${k}" aria-pressed="${st.tab === k}">${l}</button>`).join("")}</div>
  ${st.tab !== "tax" ? rangeBar(st, "bkrange", outletSel(st.outlet)) : ""}${body}`;
};
views.books.load = () => loadTab();
async function loadTab() {
  const st = BS(), q = `from=${startOf(st.from)}&to=${endOf(st.to)}&outlet=${encodeURIComponent(st.outlet)}`;
  if (st.tab === "exp") { st.list = null; render(); st.list = (await api("GET", "expenses?" + q)).expenses; }
  else if (st.tab === "pl") { st.rep = null; render(); st.rep = (await api("GET", "reports?" + q)).report; }
  else { st.tax = null; render(); st.tax = await api("GET", "books/tax?year=" + st.year); }
  render();
}
actions.bktab = async el => { BS().tab = el.dataset.v; await loadTab(); };
forms.bkrange = async d => { applyRange(BS(), d); await loadTab(); };

/* ---------- expenses ---------- */
function expTab(st) {
  if (!st.list) return `<p class="empty">Memuat…</p>`;
  const total = st.list.reduce((s, e) => s + e.amount, 0), by = {};
  for (const e of st.list) by[e.cat] = (by[e.cat] || 0) + e.amount;
  const cats = Object.entries(by).sort((a, b) => b[1] - a[1]), max = cats[0] ? cats[0][1] : 1;
  return `<div class="grid-2"><div class="panel stack"><div class="spread"><h2>Total pengeluaran</h2><b class="num" style="font-size:1.3rem">${rp(total)}</b></div>
      ${cats.length ? cats.map(([k, v]) => `<div class="stack" style="gap:.25rem"><div class="spread"><span>${esc(k)}</span><span class="num muted">${rp(v)} · ${Math.round(v / total * 100)}%</span></div><div class="bar-meter"><i style="width:${v / max * 100}%"></i></div></div>`).join("") : `<p class="muted">Belum ada pengeluaran di rentang ini.</p>`}</div>
    <div class="panel stack"><h2>Tips</h2><p class="muted" style="font-size:.9rem">Catat biaya rutin seperti gaji, sewa, listrik, gas, dan internet. Belanja barang dagangan atau bahan baku yang dicatat lewat <button class="linkish" data-a="nav" data-v="stock">Stok › Barang masuk</button> sudah dihitung sebagai harga pokok (HPP), jadi tidak perlu dicatat lagi di sini.</p>
      <p class="muted" style="font-size:.9rem">Uang yang diambil dari laci kas saat shift (kas keluar) juga tidak otomatis masuk ke sini. Catat di sini kalau itu biaya usaha.</p></div></div>
  <div class="panel tbl-wrap"><table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Keterangan</th>${S.outlets.length > 1 ? "<th>Outlet</th>" : ""}<th>Bayar</th><th class="r">Jumlah</th><th></th></tr></thead><tbody>
  ${st.list.map(e => `<tr><td class="num" style="white-space:nowrap">${new Date(e.time).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</td><td>${esc(e.cat)}</td><td>${esc(e.note || "")}<div class="muted" style="font-size:.78rem">${esc(e.by || "")}</div></td>${S.outlets.length > 1 ? `<td>${esc(outletName(e.outletId))}</td>` : ""}<td><span class="pill">${esc(e.method)}</span></td><td class="r num"><b>${rp(e.amount)}</b></td>
    <td class="r" style="white-space:nowrap"><button class="btn sm" data-a="expedit" data-id="${esc(e.id)}">Ubah</button> <button class="btn sm danger" data-a="expdel" data-id="${esc(e.id)}">Hapus</button></td></tr>`).join("") || `<tr><td colspan="7" class="empty">Belum ada pengeluaran. Tekan "Catat pengeluaran".</td></tr>`}
  </tbody></table></div>`;
}
const expModal = e => `<div class="spread"><h2>${e ? "Ubah pengeluaran" : "Catat pengeluaran"}</h2><button class="btn sm" data-a="close">Tutup</button></div>
  <form class="stack" data-form="exp" data-id="${e ? esc(e.id) : ""}">
  <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="exd">Tanggal</label><input class="input" id="exd" name="date" type="date" required max="${isoDay(Date.now())}" value="${isoDay(e ? e.time : Date.now())}"></div>
    <div class="field" style="flex:1.3"><label for="exc">Kategori</label><select class="input" id="exc" name="cat">${EXPENSE_CATS.map(c => `<option ${e && e.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div></div>
  <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="exa">Jumlah (Rp)</label><input class="input num" id="exa" name="amount" type="number" min="1" required value="${e ? e.amount : ""}" autofocus></div>
    <div class="field" style="flex:1"><label for="exm">Dibayar dengan</label><select class="input" id="exm" name="method">${METHODS.map(m => `<option ${(e ? e.method : "Tunai") === m ? "selected" : ""}>${m}</option>`).join("")}</select></div></div>
  ${S.outlets.length > 1 ? `<div class="field"><label for="exo">Outlet</label><select class="input" id="exo" name="outlet">${S.outlets.map(o => `<option value="${o.id}" ${(e ? e.outletId : S.outlet) === o.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></div>` : ""}
  <div class="field"><label for="exn">Keterangan</label><input class="input" id="exn" name="note" value="${esc(e ? e.note || "" : "")}" placeholder="mis. Token listrik Oktober"></div>
  <div class="row"><button class="btn primary" type="submit">Simpan</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`;
actions.expnew = () => openModal(expModal(null));
actions.expedit = el => openModal(expModal(BS().list.find(e => e.id === el.dataset.id)));
forms.exp = async (d, f) => {
  const id = f.dataset.id || uid("e");
  const r = await api("PUT", "expenses/" + encodeURIComponent(id), { expense: { time: new Date(d.date + "T12:00:00").getTime(), cat: d.cat, amount: +d.amount, method: d.method, note: d.note, outlet: d.outlet || S.outlet } });
  const st = BS(), list = st.list || [], i = list.findIndex(e => e.id === id);
  const inRange = r.expense.time >= startOf(st.from) && r.expense.time <= endOf(st.to) && (st.outlet === "all" || st.outlet === r.expense.outletId);
  if (i >= 0) { if (inRange) list[i] = r.expense; else list.splice(i, 1); } else if (inRange) list.unshift(r.expense);
  list.sort((a, b) => b.time - a.time); st.list = list;
  closeModal(); toast("Pengeluaran " + rp(r.expense.amount) + " tercatat" + (inRange ? "" : " (di luar rentang tanggal yang tampil)"));
};
actions.expdel = async el => {
  if (!confirm("Hapus pengeluaran ini?")) return;
  await api("DELETE", "expenses/" + encodeURIComponent(el.dataset.id));
  BS().list = BS().list.filter(e => e.id !== el.dataset.id); render();
};

/* ---------- profit & loss ---------- */
function plTab(st) {
  const R = st.rep; if (!R) return `<p class="empty">Memuat…</p>`;
  const sales = R.net - R.tax - R.service, gross = R.profit, exp = R.expenses || 0, net = R.netProfit ?? gross - exp;
  const pct = v => sales ? Math.round(v / sales * 100) + "%" : "–";
  return `<div class="tiles">
    <div class="tile"><span class="label">Penjualan</span><span class="v">${rp(sales)}</span><span class="d muted">${nf(R.count)} transaksi, tanpa pajak & service</span></div>
    <div class="tile"><span class="label">Laba kotor</span><span class="v">${rp(gross)}</span><span class="d muted">margin ${pct(gross)}</span></div>
    <div class="tile"><span class="label">Pengeluaran</span><span class="v">${rp(exp)}</span><span class="d muted">${Object.keys(R.byExpense || {}).length} kategori</span></div>
    <div class="tile"><span class="label">Laba bersih</span><span class="v ${net < 0 ? "down" : "up"}">${rp(net)}</span><span class="d muted">margin bersih ${pct(net)}</span></div></div>
  <div class="panel tbl-wrap"><table><tbody>
    <tr><td><b>Penjualan bersih</b> <span class="muted" style="font-size:.82rem">(setelah diskon & refund, tanpa pajak & service)</span></td><td class="r num"><b>${rp(sales)}</b></td><td class="r num muted">100%</td></tr>
    <tr><td>Harga pokok penjualan (HPP)</td><td class="r num down">−${rp(R.cost)}</td><td class="r num muted">${pct(R.cost)}</td></tr>
    <tr><td><b>Laba kotor</b></td><td class="r num"><b>${rp(gross)}</b></td><td class="r num muted">${pct(gross)}</td></tr>
    ${Object.entries(R.byExpense || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td style="padding-left:1.4rem">${esc(k)}</td><td class="r num down">−${rp(v)}</td><td class="r num muted">${pct(v)}</td></tr>`).join("") || `<tr><td style="padding-left:1.4rem" class="muted">Belum ada pengeluaran. <button class="linkish" data-a="bktab" data-v="exp">Catat sekarang</button></td><td></td><td></td></tr>`}
    <tr><td>Total pengeluaran operasional</td><td class="r num down">−${rp(exp)}</td><td class="r num muted">${pct(exp)}</td></tr>
    <tr><td><b>Laba bersih</b></td><td class="r num"><b class="${net < 0 ? "down" : ""}">${rp(net)}</b></td><td class="r num muted">${pct(net)}</td></tr>
  </tbody></table></div>
  <p class="muted" style="font-size:.85rem">HPP dihitung dari harga modal produk dan resep. Isi modal di setiap produk supaya laba akurat. Pajak PB1 dan service charge yang ditagih ke pelanggan tidak dihitung sebagai penjualan.</p>`;
}

/* ---------- UMKM tax ---------- */
function taxTab(st) {
  const mode = taxMode(S.settings), owner = me().role === "owner";
  const modeForm = `<form class="panel stack" data-form="taxmode"><div class="spread"><h2>Status wajib pajak</h2>${owner ? "" : `<span class="muted" style="font-size:.85rem">Diatur pemilik usaha</span>`}</div>
    <div class="featgrid">${Object.entries(TAX_MODES).map(([k, [l, h]]) => `<label class="featopt"><input type="radio" name="mode" value="${k}" ${mode === k ? "checked" : ""} ${owner ? `data-ch="taxmode"` : "disabled"}><span><b>${esc(l)}</b><span class="muted">${esc(h)}</span></span></label>`).join("")}</div></form>`;
  if (!st.tax) return modeForm + `<p class="empty">Memuat…</p>`;
  const rows = umkmTax(st.tax.months.map(m => m.bruto), mode), now = new Date();
  const yearTotal = rows.reduce((s, r) => s + r.bruto, 0), taxTotal = rows.reduce((s, r) => s + r.tax, 0);
  const due = i => new Date(st.year, i + 1, 15);
  const curIdx = st.year === now.getFullYear() ? now.getMonth() : -1;
  const prev = curIdx > 0 ? rows[curIdx - 1] : null;
  return modeForm + `<div class="spread"><div class="row"><button class="btn sm" data-a="taxyear" data-v="-1" aria-label="Tahun sebelumnya">‹</button><h2 class="num">${st.year}</h2><button class="btn sm" data-a="taxyear" data-v="1" aria-label="Tahun berikutnya" ${st.year >= now.getFullYear() ? "disabled" : ""}>›</button></div><span class="muted" style="font-size:.85rem">Semua outlet</span></div>
  ${mode === "off" ? `<div class="panel"><p class="muted">Perkiraan pajak dimatikan. Omzet per bulan tetap tampil di bawah.</p></div>` : `<div class="tiles">
    <div class="tile"><span class="label">Omzet ${st.year}</span><span class="v">${rp(yearTotal)}</span>${mode === "op" ? `<span class="d muted">${yearTotal >= TAX_FREE ? "sudah lewat batas bebas pajak" : "sisa " + rp(TAX_FREE - yearTotal) + " sebelum kena pajak"}</span><div class="bar-meter"><i style="width:${Math.min(100, yearTotal / TAX_FREE * 100)}%"></i></div>` : `<span class="d muted">peredaran bruto</span>`}</div>
    <div class="tile"><span class="label">Perkiraan PPh final ${st.year}</span><span class="v">${rp(taxTotal)}</span><span class="d muted">0,5% dari omzet${mode === "op" ? " di atas Rp500 juta" : ""}</span></div>
    ${prev ? `<div class="tile"><span class="label">Setor untuk ${MONTHS[curIdx - 1]}</span><span class="v">${rp(prev.tax)}</span><span class="d muted">paling lambat ${fmtDate(due(curIdx - 1).getTime())}</span></div>` : ""}</div>`}
  <div class="panel tbl-wrap"><table><thead><tr><th>Bulan</th><th class="r">Transaksi</th><th class="r">Omzet bruto</th>${mode === "op" ? `<th class="r">Akumulasi</th>` : ""}${mode !== "off" ? `<th class="r">Kena pajak</th><th class="r">PPh 0,5%</th><th class="r">Setor paling lambat</th>` : ""}</tr></thead><tbody>
  ${rows.map((r, i) => `<tr${i === curIdx ? ' style="background:var(--accent-soft)"' : ""}><td>${MONTHS[i]}${i === curIdx ? ' <span class="pill ok">berjalan</span>' : ""}</td><td class="r num">${nf(st.tax.months[i].count)}</td><td class="r num">${rp(r.bruto)}</td>${mode === "op" ? `<td class="r num muted">${rp(r.cum)}</td>` : ""}${mode !== "off" ? `<td class="r num">${rp(r.taxable)}</td><td class="r num"><b>${rp(r.tax)}</b></td><td class="r num muted">${r.tax ? due(i).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "–"}</td>` : ""}</tr>`).join("")}
  </tbody></table></div>
  <div class="panel stack" style="gap:.5rem"><h3>Cara setor</h3><ul class="muted" style="margin:0;padding-left:1.1rem;font-size:.88rem;display:grid;gap:.25rem">
    <li>Buat kode billing di Coretax / e-Billing DJP dengan kode akun pajak <b>411128</b> dan kode jenis setoran <b>420</b>, lalu bayar lewat bank, ATM, m-banking, atau kantor pos.</li>
    <li>Omzet dihitung dari penjualan bersih setelah refund, tanpa PB1/PPN yang ditagih ke pelanggan.</li>
    <li>Tarif 0,5% berlaku untuk omzet sampai Rp4,8 miliar setahun, dengan batas waktu: orang pribadi 7 tahun, CV/koperasi 4 tahun, PT 3 tahun sejak terdaftar.</li>
    <li>Angka ini perkiraan untuk membantu. Pastikan ke konsultan pajak atau KPP kalau ragu.</li></ul></div>`;
}
changes.taxmode = async el => {
  const r = await api("PUT", "settings", { settings: { books: { taxMode: el.value } } });
  S.settings = r.settings; render(); toast("Status pajak: " + TAX_MODES[el.value][0]);
};
actions.taxyear = async el => { const st = BS(); st.year += +el.dataset.v; await loadTab(); };

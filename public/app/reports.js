// Reports with date range and Excel export, transaction history with refunds, and cashier shifts.
import { S, views, actions, forms, inputs, changes, api, toast, render, openModal, closeModal, esc, rp, nf, fmtDT, fmtDate, isoDay, isMgr, me, net, outletName, outbox, dropOutbox, sync } from "./core.js";
import { barChart } from "./manage.js";
import { receiptModal } from "./pos.js";

const DAYMS = 86400000;
export const startOf = s => new Date(s + "T00:00:00").getTime(), endOf = s => new Date(s + "T23:59:59.999").getTime();
const PRESETS = [["today", "Hari ini"], ["yday", "Kemarin"], ["7", "7 hari"], ["30", "30 hari"], ["month", "Bulan ini"], ["lmonth", "Bulan lalu"]];
export function preset(k) {
  const now = new Date(), today = isoDay(now);
  if (k === "today") return [today, today];
  if (k === "yday") { const y = isoDay(Date.now() - DAYMS); return [y, y]; }
  if (k === "7" || k === "30") return [isoDay(Date.now() - (+k - 1) * DAYMS), today];
  if (k === "month") return [isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), today];
  if (k === "lmonth") return [isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)), isoDay(new Date(now.getFullYear(), now.getMonth(), 0))];
}
export const rangeBar = (st, form, extra = "") => `<form class="row" data-form="${form}">${PRESETS.map(([k, l]) => `<button class="btn sm" type="submit" name="preset" value="${k}" ${st.preset === k ? 'aria-pressed="true" style="border-color:var(--accent);color:var(--accent)"' : ""}>${l}</button>`).join("")}
  <input class="input" type="date" name="from" value="${st.from}" aria-label="Dari tanggal" style="width:auto"><span class="muted">s/d</span><input class="input" type="date" name="to" value="${st.to}" aria-label="Sampai tanggal" style="width:auto">${extra}<button class="btn sm primary" type="submit" name="preset" value="">Tampilkan</button></form>`;
export const outletSel = (v, name = "outlet") => S.outlets.length > 1 ? `<select class="input" name="${name}" aria-label="Outlet" style="width:auto"><option value="all" ${v === "all" ? "selected" : ""}>Semua outlet</option>${S.outlets.map(o => `<option value="${o.id}" ${v === o.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>` : "";
export function applyRange(st, d) { if (d.preset) { [st.from, st.to] = preset(d.preset); st.preset = d.preset; } else { st.from = d.from || st.from; st.to = d.to || st.to; st.preset = ""; } if (d.outlet) st.outlet = d.outlet; }

/* ---------- reports ---------- */
const RS = () => S.ui.rep || (S.ui.rep = { preset: "7", from: preset("7")[0], to: preset("7")[1], outlet: "all", data: null, tab: "ringkas" });
views.reports = () => {
  const st = RS(), d = st.data, R = d && d.report;
  const tabs = [["ringkas", "Ringkasan"], ["produk", "Produk"], ["kategori", "Kategori"], ["kasir", "Kasir"], ["metode", "Metode bayar"], ["jam", "Per jam"], ["outlet", "Outlet"], ["batal", "Refund & batal"], ["shift", "Shift"]].filter(([k]) => k !== "outlet" || S.outlets.length > 1);
  const tbl = (head, rows) => `<div class="panel tbl-wrap"><table><thead><tr>${head.map((h, i) => `<th${i ? ' class="r"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="empty">Tidak ada data.</td></tr>`}</tbody></table></div>`;
  const grp = (o, label = k => k) => Object.entries(o).sort((a, b) => b[1].total - a[1].total).map(([k, v]) => `<tr><td>${esc(label(k))}</td><td class="r num">${nf(v.count)}</td><td class="r num">${rp(v.total)}</td><td class="r num muted">${R.net ? Math.round(v.total / R.net * 100) : 0}%</td></tr>`);
  let body = "";
  if (!d) body = `<p class="empty">Memuat laporan…</p>`;
  else if (st.tab === "ringkas") {
    const days = []; for (let t = startOf(st.from); t <= endOf(st.to) && days.length < 400; t += DAYMS) { const k = isoDay(t); days.push({ label: new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short" }), v: (R.byDay[k] || {}).total || 0 }); }
    body = `<div class="tiles">
      <div class="tile"><span class="label">Penjualan bersih</span><span class="v">${rp(R.net)}</span><span class="d muted">${R.count} transaksi · rata-rata ${rp(R.count ? R.net / R.count : 0)}</span></div>
      <div class="tile"><span class="label">Laba kotor</span><span class="v">${rp(R.profit)}</span><span class="d muted">margin ${R.net ? Math.round(R.profit / (R.net - R.tax - R.service || 1) * 100) : 0}% dari penjualan sebelum pajak</span></div>
      <div class="tile"><span class="label">Harga pokok (HPP)</span><span class="v">${rp(R.cost)}</span><span class="d muted">${nf(Math.round(R.items))} item terjual</span></div>
      <div class="tile"><span class="label">Diskon & refund</span><span class="v">${rp(R.discount + R.refunds)}</span><span class="d muted">diskon ${rp(R.discount)} · refund ${rp(R.refunds)}</span></div>
      <div class="tile"><span class="label">Pajak & service</span><span class="v">${rp(R.tax + R.service)}</span><span class="d muted">pajak ${rp(R.tax)} · service ${rp(R.service)}</span></div></div>
      <div class="panel stack"><h2>Penjualan per hari</h2>${barChart(days, "Penjualan per hari")}</div>
      <div class="panel tbl-wrap"><table><tbody>
        <tr><td>Penjualan kotor (sebelum diskon)</td><td class="r num">${rp(R.gross)}</td></tr><tr><td>Diskon, promo, voucher, poin</td><td class="r num down">−${rp(R.discount)}</td></tr>
        <tr><td>Service</td><td class="r num">${rp(R.service)}</td></tr><tr><td>Pajak</td><td class="r num">${rp(R.tax)}</td></tr><tr><td>Refund & pembatalan</td><td class="r num down">−${rp(R.refunds)}</td></tr>
        <tr><td><b>Penjualan bersih</b></td><td class="r num"><b>${rp(R.net)}</b></td></tr><tr><td>Harga pokok penjualan</td><td class="r num down">−${rp(R.cost)}</td></tr><tr><td>Pajak & service (disetor/dibagi)</td><td class="r num down">−${rp(R.tax + R.service)}</td></tr>
        <tr><td><b>Laba kotor</b></td><td class="r num"><b>${rp(R.profit)}</b></td></tr><tr><td>Pengeluaran operasional <button class="linkish" data-a="nav" data-v="books">lihat</button></td><td class="r num down">−${rp(R.expenses || 0)}</td></tr>
        <tr><td><b>Laba bersih</b></td><td class="r num"><b class="${(R.netProfit ?? R.profit) < 0 ? "down" : ""}">${rp(R.netProfit ?? R.profit)}</b></td></tr></tbody></table></div>`;
  } else if (st.tab === "produk") body = tbl(["Produk", "Kategori", "Terjual", "Penjualan", "HPP", "Laba"], Object.entries(R.byProduct).sort((a, b) => b[1].total - a[1].total).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r muted">${esc(v.cat || "")}</td><td class="r num">${nf(v.qty)}</td><td class="r num">${rp(v.total)}</td><td class="r num">${rp(v.cost)}</td><td class="r num">${rp(v.total - v.cost)}</td></tr>`));
  else if (st.tab === "kategori") body = tbl(["Kategori", "Item", "Penjualan", "Porsi"], grp(R.byCategory));
  else if (st.tab === "kasir") body = tbl(["Kasir", "Transaksi", "Penjualan", "Porsi"], grp(R.byCashier));
  else if (st.tab === "metode") body = tbl(["Metode", "Transaksi", "Penjualan", "Porsi"], grp(R.byMethod));
  else if (st.tab === "outlet") body = tbl(["Outlet", "Transaksi", "Penjualan", "Porsi"], grp(R.byOutlet, outletName));
  else if (st.tab === "jam") body = tbl(["Jam", "Transaksi", "Penjualan", "Porsi"], Array.from({ length: 24 }, (_, h) => [h, R.byHour[h]]).filter(x => x[1]).map(([h, v]) => `<tr><td class="num">${String(h).padStart(2, "0")}.00–${String(h + 1).padStart(2, "0")}.00</td><td class="r num">${v.count}</td><td class="r num">${rp(v.total)}</td><td class="r num muted">${R.net ? Math.round(v.total / R.net * 100) : 0}%</td></tr>`));
  else if (st.tab === "batal") body = tbl(["Transaksi", "Waktu", "Total", "Dikembalikan", "Alasan (disetujui)"], R.voids.map(v => `<tr><td class="num">${esc(v.id)} ${v.status === "void" ? '<span class="pill bad">batal</span>' : '<span class="pill gold">sebagian</span>'}</td><td class="r num">${fmtDT(v.time)}</td><td class="r num">${rp(v.total)}</td><td class="r num down">${rp(v.refunded)}</td><td class="r">${esc(v.reasons)}</td></tr>`));
  else if (st.tab === "shift") body = shiftTable(d.shifts);
  return `<div class="spread"><div><h1>Laporan</h1><p class="muted">${fmtDate(startOf(st.from))} – ${fmtDate(startOf(st.to))}${S.outlets.length > 1 ? " · " + (st.outlet === "all" ? "semua outlet" : esc(outletName(st.outlet))) : ""}</p></div><button class="btn" data-a="xlsx" ${d ? "" : "disabled"}>Ekspor Excel</button></div>
  ${rangeBar(st, "reprange", outletSel(st.outlet))}
  <div class="seg" role="tablist" aria-label="Jenis laporan">${tabs.map(([k, l]) => `<button data-a="reptab" data-v="${k}" aria-pressed="${st.tab === k}">${l}</button>`).join("")}</div>${body}`;
};
views.reports.load = async () => { const st = RS(); st.data = null; render(); st.data = await api("GET", `reports?from=${startOf(st.from)}&to=${endOf(st.to)}&outlet=${encodeURIComponent(st.outlet)}`); render(); };
forms.reprange = async d => { applyRange(RS(), d); await views.reports.load(); };
actions.reptab = el => { RS().tab = el.dataset.v; render(); };
function shiftTable(shifts) {
  return `<div class="panel tbl-wrap"><table><thead><tr><th>Kasir</th><th>Outlet</th><th>Buka</th><th>Tutup</th><th class="r">Modal</th><th class="r">Penjualan</th><th class="r">Kas seharusnya</th><th class="r">Kas dihitung</th><th class="r">Selisih</th></tr></thead><tbody>
  ${shifts.map(s => { const sm = s.summary || {}; return `<tr><td>${esc(s.userName || "")}</td><td>${esc(outletName(s.outletId))}</td><td class="num">${fmtDT(s.opened)}</td><td class="num">${s.closed ? fmtDT(s.closed) : '<span class="pill ok">berjalan</span>'}</td><td class="r num">${rp(s.openCash)}</td><td class="r num">${rp(sm.sales || 0)}</td><td class="r num">${rp(s.closed ? s.expected : sm.expected || 0)}</td><td class="r num">${s.closed ? rp(s.counted) : "–"}</td><td class="r num ${s.diff < 0 ? "down" : s.diff > 0 ? "up" : ""}">${s.closed ? (s.diff > 0 ? "+" : "") + rp(s.diff) : "–"}</td></tr>`; }).join("") || `<tr><td colspan="9" class="empty">Belum ada shift di rentang ini.</td></tr>`}
  </tbody></table></div>`;
}
actions.xlsx = async el => {
  el.disabled = true;
  if (!window.XLSX) await new Promise((ok, bad) => { const s = document.createElement("script"); s.src = "vendor/xlsx.mini.min.js"; s.onload = ok; s.onerror = () => bad(new Error("Gagal memuat pengekspor Excel")); document.head.appendChild(s); });
  const st = RS(), R = st.data.report, X = window.XLSX, wb = X.utils.book_new();
  const add = (name, rows) => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), name);
  add("Ringkasan", [["Laporan " + S.tenant.name], ["Periode", st.from + " s/d " + st.to], ["Outlet", st.outlet === "all" ? "Semua" : outletName(st.outlet)], [], ["Transaksi", R.count], ["Penjualan kotor", R.gross], ["Diskon", R.discount], ["Service", R.service], ["Pajak", R.tax], ["Refund", R.refunds], ["Penjualan bersih", R.net], ["HPP", R.cost], ["Laba kotor", R.profit], ["Pengeluaran operasional", R.expenses || 0], ["Laba bersih", R.netProfit ?? R.profit]]);
  add("Pengeluaran", [["Kategori", "Jumlah"], ...Object.entries(R.byExpense || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)])]);
  add("Per hari", [["Tanggal", "Transaksi", "Penjualan"], ...Object.entries(R.byDay).sort().map(([k, v]) => [k, v.count, Math.round(v.total)])]);
  add("Produk", [["Produk", "Kategori", "Terjual", "Penjualan", "HPP", "Laba"], ...Object.entries(R.byProduct).sort((a, b) => b[1].total - a[1].total).map(([k, v]) => [k, v.cat || "", +v.qty.toFixed(2), Math.round(v.total), Math.round(v.cost), Math.round(v.total - v.cost)])]);
  const g = (name, o, lab = k => k) => add(name, [[name, "Jumlah", "Penjualan"], ...Object.entries(o).sort((a, b) => b[1].total - a[1].total).map(([k, v]) => [lab(k), +(+v.count).toFixed(2), Math.round(v.total)])]);
  g("Kategori", R.byCategory); g("Kasir", R.byCashier); g("Metode bayar", R.byMethod); g("Outlet", R.byOutlet, outletName);
  add("Per jam", [["Jam", "Transaksi", "Penjualan"], ...Object.entries(R.byHour).map(([h, v]) => [String(h).padStart(2, "0") + ":00", v.count, Math.round(v.total)])]);
  add("Refund", [["Transaksi", "Waktu", "Total", "Dikembalikan", "Status", "Alasan"], ...R.voids.map(v => [v.id, new Date(v.time).toLocaleString("id-ID"), v.total, v.refunded, v.status, v.reasons])]);
  add("Shift", [["Kasir", "Outlet", "Buka", "Tutup", "Modal", "Penjualan", "Kas seharusnya", "Kas dihitung", "Selisih"], ...st.data.shifts.map(s => [s.userName, outletName(s.outletId), new Date(s.opened).toLocaleString("id-ID"), s.closed ? new Date(s.closed).toLocaleString("id-ID") : "", s.openCash, (s.summary || {}).sales || 0, s.expected ?? "", s.counted ?? "", s.diff ?? ""])]);
  try {
    const t = await api("GET", `trx?from=${startOf(st.from)}&to=${endOf(st.to)}&outlet=${encodeURIComponent(st.outlet)}`);
    add("Transaksi", [["No", "Waktu", "Outlet", "Kasir", "Pelanggan", "Item", "Subtotal", "Diskon", "Service", "Pajak", "Total", "Dikembalikan", "Metode", "Status"], ...t.transactions.map(x => [x.id, new Date(x.time).toLocaleString("id-ID"), outletName(x.outletId || "main"), x.cashierName || "", x.customer ? x.customer.name : "", x.items.map(i => i.qty + "x " + i.name).join(", "), x.subtotal, x.discount, x.service || 0, x.tax, x.total, x.refunded || 0, x.method, x.status || "ok"])]);
  } catch (e) {}
  X.writeFile(wb, `Laporan-${S.tenant.name.replace(/[^\w]+/g, "-")}-${st.from}_${st.to}.xlsx`);
  el.disabled = false; toast("File Excel diunduh");
};

/* ---------- transactions ---------- */
const TS = () => S.ui.trx || (S.ui.trx = { preset: "today", from: preset("today")[0], to: preset("today")[1], outlet: S.outlet, q: "", loaded: false });
views.trx = u => {
  const st = TS(), list = (S.ui.trxList || []).concat(S.data.transactions.filter(x => x.pending)).filter(x => !st.q || x.id.toLowerCase().includes(st.q.toLowerCase()) || (x.customer && x.customer.name.toLowerCase().includes(st.q.toLowerCase())));
  const total = list.filter(x => !x.pending).reduce((s, x) => s + net(x), 0);
  const pend = outbox();
  return `<div class="spread"><div><h1>${u.role === "cashier" ? "Transaksi Saya" : "Transaksi"}</h1><p class="muted">${list.length} transaksi · ${rp(total)} bersih</p></div></div>
  ${pend.length ? `<div class="trial-bar"><span><b>${pend.length} transaksi offline menunggu dikirim.</b> <span class="muted">Terkirim otomatis begitu internet tersambung.</span></span><button class="btn sm" data-a="syncnow">Kirim sekarang</button></div>` : ""}
  ${rangeBar(st, "trxrange", isMgr(u) ? outletSel(st.outlet) : "")}
  <input class="input" type="search" id="trxq" data-in="trxq" value="${esc(st.q)}" placeholder="Cari nomor transaksi atau nama member" autocomplete="off">
  <div class="panel tbl-wrap"><table><thead><tr><th>Waktu</th><th>No.</th><th>Kasir</th><th>Item</th><th>Metode</th><th class="r">Total</th></tr></thead><tbody>
  ${!st.loaded ? `<tr><td colspan="6" class="empty">Memuat…</td></tr>` : list.slice(0, 500).map(x => `<tr class="click" data-a="viewtrx" data-id="${esc(x.id)}"><td class="num" style="white-space:nowrap">${fmtDT(x.time)}</td><td class="num muted">${esc(x.id)}${x.table ? `<div style="font-size:.78rem">Meja ${esc(x.table)}</div>` : ""}</td><td>${esc(x.cashierName || "-")}${x.customer ? `<div class="muted" style="font-size:.78rem">👤 ${esc(x.customer.name)}</div>` : ""}</td><td class="muted">${x.items.reduce((s, i) => s + i.qty, 0)} item</td><td><span class="pill ${x.method === "QRIS" ? "ok" : ""}">${esc(x.method)}</span>${x.pending ? ' <span class="pill gold">offline</span>' : ""}${x.status === "void" ? ' <span class="pill bad">batal</span>' : x.status === "partial" ? ' <span class="pill gold">refund</span>' : ""}</td><td class="r num" style="font-weight:700">${x.status === "void" ? `<s class="muted">${rp(x.total)}</s>` : rp(net(x))}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Belum ada transaksi di rentang ini.</td></tr>`}
  </tbody></table></div>`;
};
views.trx.load = async () => { const st = TS(); st.loaded = false; render(); const r = await api("GET", `trx?from=${startOf(st.from)}&to=${endOf(st.to)}&outlet=${encodeURIComponent(st.outlet)}`); S.ui.trxList = r.transactions; st.loaded = true; render(); };
forms.trxrange = async d => { applyRange(TS(), d); await views.trx.load(); };
inputs.trxq = el => { TS().q = el.value; render(); };
actions.syncnow = async () => { await sync(); render(); };

/* ---------- shift ---------- */
views.shift = u => {
  const s = S.data.shift, sm = S.ui.shiftSum;
  const cur = s ? `<div class="panel stack"><div class="spread"><h2>Shift berjalan</h2><span class="pill ok">dibuka ${fmtDT(s.opened)}</span></div>
    ${sm ? `<div class="tiles"><div class="tile"><span class="label">Modal awal</span><span class="v">${rp(s.openCash)}</span></div><div class="tile"><span class="label">Penjualan</span><span class="v">${rp(sm.sales)}</span><span class="d muted">${sm.count} transaksi</span></div><div class="tile"><span class="label">Penjualan tunai</span><span class="v">${rp(sm.cashSales)}</span><span class="d muted">refund tunai ${rp(sm.cashRefunds)}</span></div><div class="tile"><span class="label">Kas seharusnya di laci</span><span class="v">${rp(sm.expected)}</span><span class="d muted">masuk ${rp(sm.cashIn)} · keluar ${rp(sm.cashOut)}</span></div></div>
      <div class="tbl-wrap"><table><tbody>${Object.entries(sm.byMethod || {}).map(([m, v]) => `<tr><td>${esc(m)}</td><td class="r num">${rp(v)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Memuat ringkasan…</p>`}
    ${(s.cash || []).length ? `<div class="stack" style="gap:.3rem"><span class="label">Kas masuk / keluar</span>${s.cash.map(c => `<div class="spread" style="font-size:.9rem"><span>${fmtDT(c.time)} · ${esc(c.note || "")}</span><span class="num ${c.type === "out" ? "down" : "up"}">${c.type === "out" ? "−" : "+"}${rp(c.amount)}</span></div>`).join("")}</div>` : ""}
    <form class="row" data-form="shiftcash" style="flex-wrap:nowrap"><select class="input" name="type" style="width:auto" aria-label="Jenis"><option value="out">Kas keluar</option><option value="in">Kas masuk</option></select><input class="input num" name="amount" type="number" min="1" required placeholder="Jumlah" aria-label="Jumlah"><input class="input" name="note" required placeholder="Keterangan, mis. beli es batu" aria-label="Keterangan"><button class="btn" type="submit">Catat</button></form>
    <form class="panel stack" data-form="shiftclose" style="border-color:var(--gold)"><h3>Tutup shift</h3><p class="muted" style="font-size:.88rem">Hitung semua uang tunai di laci, lalu isi jumlahnya. Selisih dengan kas seharusnya tercatat di laporan.</p>
      <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="scc">Uang tunai dihitung</label><input class="input num" id="scc" name="counted" type="number" min="0" required></div><div class="field" style="flex:2"><label for="scn">Catatan</label><input class="input" id="scn" name="note" placeholder="opsional"></div></div>
      <div><button class="btn primary" type="submit">Tutup shift & cetak ringkasan</button></div></form></div>`
    : `<div class="panel stack"><h2>Belum ada shift terbuka</h2><p class="muted">Buka shift sebelum mulai berjualan. Modal awal dipakai untuk menghitung kas seharusnya saat tutup shift.</p><form class="row" data-form="shiftopen" style="flex-wrap:nowrap"><input class="input num" name="openCash" type="number" min="0" required placeholder="Modal awal kas" aria-label="Modal awal kas"><button class="btn primary" type="submit">Buka shift</button></form></div>`;
  const hist = isMgr(u) ? `<div class="spread"><h2>Riwayat shift</h2>${S.ui.shiftList ? "" : `<button class="btn sm" data-a="shifthist">Tampilkan 30 hari</button>`}</div>${S.ui.shiftList ? shiftTable(S.ui.shiftList) : ""}` : "";
  const last = S.ui.lastShift;
  return `<div><h1>Shift kasir</h1><p class="muted">${esc(u.name)} · ${esc(outletName(S.outlet))}</p></div>
  ${last ? `<div class="trial-bar ${last.diff < 0 ? "bad" : ""}"><span><b>Shift ditutup.</b> Kas seharusnya ${rp(last.expected)}, dihitung ${rp(last.counted)}, selisih <b class="num">${last.diff > 0 ? "+" : ""}${rp(last.diff)}</b>.</span></div>` : ""}${cur}${hist}`;
};
views.shift.load = async () => { const r = await api("GET", "shift"); S.data.shift = r.shift; S.ui.shiftSum = r.shift ? r.shift.summary : null; render(); };
forms.shiftcash = async (d, f) => { const r = await api("POST", "shift/cash", { type: d.type, amount: +d.amount, note: d.note }); S.data.shift = r.shift; S.ui.shiftSum = r.shift.summary; f.reset(); render(); toast("Tercatat"); };
forms.shiftclose = async d => {
  const r = await api("POST", "shift/close", { counted: +d.counted, note: d.note });
  S.ui.lastShift = r.shift; S.data.shift = null; S.ui.shiftSum = null; render(); toast("Shift ditutup");
  const s = r.shift, sm = s.summary || {};
  const { printText } = await import("./print.js");
  printText(`TUTUP SHIFT\n${S.tenant.name}\n${outletName(s.outletId)}\nKasir: ${s.userName}\nBuka : ${fmtDT(s.opened)}\nTutup: ${fmtDT(s.closed)}\n--------------------------------\nModal awal     ${rp(s.openCash)}\nPenjualan      ${rp(sm.sales || 0)} (${sm.count || 0} trx)\n${Object.entries(sm.byMethod || {}).map(([m, v]) => "  " + m + "  " + rp(v)).join("\n")}\nTunai masuk    ${rp(sm.cashSales || 0)}\nRefund tunai   ${rp(sm.cashRefunds || 0)}\nKas masuk      ${rp(sm.cashIn || 0)}\nKas keluar     ${rp(sm.cashOut || 0)}\n--------------------------------\nSeharusnya     ${rp(s.expected)}\nDihitung       ${rp(s.counted)}\nSelisih        ${rp(s.diff)}\n`);
};
actions.shifthist = async () => { S.ui.shiftList = (await api("GET", "shifts?from=" + (Date.now() - 30 * DAYMS))).shifts; render(); };

/* ---------- offline outbox (account page) ---------- */
export function outboxPanel() {
  const list = outbox();
  if (!list.length) return "";
  return `<div class="panel stack"><h2>Transaksi offline</h2><p class="muted" style="font-size:.9rem">Tersimpan di perangkat ini dan dikirim otomatis saat online.</p>
  <div class="tbl-wrap"><table><tbody>${list.map(x => `<tr><td class="num">${esc(x.id)}</td><td class="num">${fmtDT(x.created)}</td><td>${x.error ? `<span class="down" style="font-size:.85rem">${esc(x.error)}</span>` : '<span class="pill gold">menunggu</span>'}</td><td class="r">${x.error ? `<button class="btn sm danger" data-a="obdrop" data-id="${esc(x.id)}">Buang</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
  <div><button class="btn" data-a="syncnow">Kirim sekarang</button></div></div>`;
}
actions.obdrop = el => { if (!confirm("Buang transaksi offline ini? Stok dan laporan tidak akan mencatatnya.")) return; dropOutbox(el.dataset.id); render(); };
void [changes, openModal, closeModal, me, receiptModal];

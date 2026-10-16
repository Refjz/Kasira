// Back office: dashboard, products (units, wholesale, options, recipes), stock (goods in, stock count,
// transfer, history, suppliers), members, promos and vouchers, staff, outlets and business settings.
import { S, views, actions, forms, inputs, changes, api, toast, render, openModal, closeModal, esc, rp, nf, uid, initials, dayKey, daysTo, fmtDate, fmtDT, isoDay,
  isFnb, isRetail, isMgr, me, net, stockOf, outletName, ROLE, $, boot, loadData } from "./core.js";
import { openCamera } from "./pos.js";
import { unitCost } from "./pricing.js";

const arr = v => v === undefined ? [] : [].concat(v);
const dateTs = (s, end) => s ? new Date(s + (end ? "T23:59:59" : "T00:00:00")).getTime() : undefined;

/* ---------- charts ---------- */
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
export function short(v) { return v >= 1e6 ? (v / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " jt" : v >= 1e3 ? Math.round(v / 1e3) + " rb" : String(Math.round(v)); }
export function barChart(days, label = "Omzet") {
  const W = 640, H = 220, L = 56, B = 28, T = 12; const max = Math.max(...days.map(d => d.v), 1);
  const step = niceStep(max / 4), top = Math.ceil(max / step) * step, bw = (W - L - 10) / Math.max(days.length, 1);
  const every = Math.ceil(days.length / 14);
  let g = ""; for (let v = 0; v <= top; v += step) { const y = T + (H - T - B) * (1 - v / top); g += `<line class="grid" x1="${L}" x2="${W - 6}" y1="${y}" y2="${y}"/><text x="${L - 8}" y="${y + 4}" text-anchor="end">${short(v)}</text>`; }
  const bars = days.map((d, i) => { const h = (H - T - B) * (d.v / top), x = L + i * bw + bw * .18; return `<rect class="bar${d.hi ? " today" : ""}" x="${x}" y="${H - B - h}" width="${bw * .64}" height="${Math.max(h, 0)}" rx="3"><title>${esc(d.label)}: ${rp(d.v)}</title></rect>${i % every === 0 ? `<text x="${x + bw * .32}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>` : ""}`; }).join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${g}${bars}</svg></div>`;
}
function last7(list) {
  const days = []; for (let d = 6; d >= 0; d--) { const dt = new Date(Date.now() - d * 86400000); days.push({ key: dayKey(dt), label: dt.toLocaleDateString("id-ID", { weekday: "short" }), v: 0, hi: d === 0 }); }
  for (const x of list) { const d = days.find(a => a.key === dayKey(x.time)); if (d) d.v += net(x); }
  return days;
}

/* ---------- dashboard ---------- */
views.dash = (u, t) => {
  const all = S.data.transactions.filter(x => x.status !== "void");
  const today = dayKey(Date.now()), yday = dayKey(Date.now() - 86400000);
  const tt = all.filter(x => dayKey(x.time) === today), yy = all.filter(x => dayKey(x.time) === yday);
  const sum = l => l.reduce((s, x) => s + net(x), 0);
  const gp = l => l.reduce((s, x) => { const r = x.total ? net(x) / x.total : 1; return s + (net(x) - (x.tax || 0) * r - (x.service || 0) * r - x.items.reduce((a, i) => a + (i.cost || 0) * i.qty, 0) * r); }, 0);
  const rev = sum(tt), revY = sum(yy), delta = revY ? Math.round((rev - revY) / revY * 100) : 0;
  const week = all.filter(x => x.time > Date.now() - 7 * 86400000);
  const top = {}; for (const x of week) for (const i of x.items) top[i.name] = (top[i.name] || 0) + i.qty;
  const topList = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5), topMax = topList[0] ? topList[0][1] : 1;
  const hours = {}; for (const x of week) { const h = new Date(x.time).getHours(); hours[h] = (hours[h] || 0) + 1; }
  const peak = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
  const low = S.data.products.filter(p => p.track !== false && !p.recipe && (S.data.stock[p.id] || 0) <= (p.minStock || 10)).sort((a, b) => (S.data.stock[a.id] || 0) - (S.data.stock[b.id] || 0));
  const methods = {}; for (const x of week) methods[x.method] = (methods[x.method] || 0) + net(x);
  const qrisShare = sum(week) ? Math.round((methods.QRIS || 0) / sum(week) * 100) : 0;
  const members = week.filter(x => x.customer).length;
  const ex = S.data.products.filter(p => p.exp && daysTo(p.exp) <= 14).sort((a, b) => a.exp - b.exp);
  return `<div class="spread"><div><div class="label">${new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${esc(outletName(S.outlet))}</div><h1>Halo, ${esc(u.name.split(" ")[0])}</h1></div><div class="row"><button class="btn" data-a="nav" data-v="reports">Laporan lengkap</button><button class="btn primary" data-a="nav" data-v="pos">Buka kasir</button></div></div>
  <div class="tiles">
    <div class="tile"><span class="label">Omzet hari ini</span><span class="v">${rp(rev)}</span><span class="d ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% dibanding kemarin</span></div>
    <div class="tile"><span class="label">Transaksi hari ini</span><span class="v">${tt.length}</span><span class="d muted">kemarin ${yy.length}</span></div>
    <div class="tile"><span class="label">Rata-rata per struk</span><span class="v">${rp(tt.length ? rev / tt.length : 0)}</span><span class="d muted">hari ini</span></div>
    <div class="tile"><span class="label">Laba kotor hari ini</span><span class="v">${rp(gp(tt))}</span><span class="d muted">setelah modal, pajak, service</span></div>
  </div>
  <div class="grid-2">
    <div class="panel stack"><div class="spread"><h2>Omzet 7 hari</h2><span class="muted num" style="font-size:.85rem">total ${rp(sum(week))}</span></div>${barChart(last7(all), "Omzet 7 hari terakhir")}</div>
    <div class="panel stack"><h2>Wawasan minggu ini</h2><div class="stack" style="gap:.7rem;font-size:.93rem">
      ${peak ? `<p><b>Jam tersibuk ${String(peak[0]).padStart(2, "0")}.00–${String(+peak[0] + 1).padStart(2, "0")}.00.</b> <span class="muted">${peak[1]} transaksi.</span></p>` : ""}
      <p><b>${qrisShare}% omzet lewat QRIS.</b> <span class="muted">Sisanya tunai, kartu, dan lainnya.</span></p>
      ${week.length ? `<p><b>${Math.round(members / week.length * 100)}% transaksi dari member.</b> <span class="muted">${S.data.customers.length} member terdaftar.</span></p>` : ""}
      ${ex.length ? `<p><b>${ex.length} produk kedaluwarsa dalam 14 hari.</b> <span class="muted">${ex.slice(0, 4).map(p => esc(p.name) + " (" + daysTo(p.exp) + " hari)").join(", ")}.</span></p>` : ""}
      ${isFnb(t) ? (() => { const ot = {}; for (const x of week) if (x.orderType) ot[x.orderType] = (ot[x.orderType] || 0) + 1; const n = Object.values(ot).reduce((a, b) => a + b, 0) || 1; return `<p><b>${Math.round((ot["Makan di sini"] || 0) / n * 100)}% makan di tempat.</b> <span class="muted">${Math.round((ot["Bawa pulang"] || 0) / n * 100)}% bawa pulang, ${Math.round((ot["Ojol"] || 0) / n * 100)}% lewat ojol.</span></p>`; })() : ""}
      ${low.length ? `<p><b>${low.length} produk hampir habis.</b> <span class="muted">${low.slice(0, 3).map(p => esc(p.name)).join(", ")}${low.length > 3 ? " dan lainnya" : ""}.</span></p>` : `<p class="muted">Semua stok aman.</p>`}
    </div></div>
  </div>
  <div class="grid-2">
    <div class="panel stack"><h2>Produk terlaris (7 hari)</h2>${topList.length ? topList.map(([n, q]) => `<div class="stack" style="gap:.25rem"><div class="spread"><span>${esc(n)}</span><span class="num muted">${nf(q)} terjual</span></div><div class="bar-meter"><i style="width:${q / topMax * 100}%"></i></div></div>`).join("") : `<p class="empty">Belum ada penjualan.</p>`}</div>
    <div class="panel stack"><div class="spread"><h2>Stok menipis</h2><button class="btn sm" data-a="nav" data-v="stock">Kelola stok</button></div>
      ${low.length ? `<div class="tbl-wrap"><table><tbody>${low.slice(0, 10).map(p => { const s = S.data.stock[p.id] || 0; return `<tr><td>${esc(p.name)}</td><td class="r"><span class="pill ${s <= 0 ? "bad" : "gold"}">${s <= 0 ? "habis" : nf(s) + " " + esc(p.unit || "") + " sisa"}</span></td></tr>`; }).join("")}</tbody></table></div>` : `<p class="muted">Tidak ada.</p>`}
    </div>
  </div>`;
};

/* ---------- products ---------- */
let prodQ = "", prodCat = "Semua";
views.products = (u, t) => {
  const q = prodQ.toLowerCase();
  const cats = ["Semua", ...new Set(S.data.products.map(p => p.cat)), "Bahan baku"];
  const list = S.data.products.filter(p => (prodCat === "Semua" || (prodCat === "Bahan baku" ? p.ingredient : p.cat === prodCat)) && (!q || p.name.toLowerCase().includes(q) || (p.sku || "").includes(q)));
  return `<div class="spread"><div><h1>Produk</h1><p class="muted">${S.data.products.length} produk · stok yang tampil untuk ${esc(outletName(S.outlet))}</p></div><div class="row"><button class="btn" data-a="nav" data-v="stock">Stok & barang masuk</button><button class="btn primary" data-a="newprod">Tambah produk</button></div></div>
  <div class="row" style="flex-wrap:nowrap"><input class="input" id="prodq" type="search" data-in="prodq" value="${esc(prodQ)}" placeholder="Cari nama atau barcode" autocomplete="off"><button class="btn" data-a="prodscan" aria-label="Cari pakai kamera">Scan</button></div>
  <div class="cats" role="group" aria-label="Kategori">${cats.map(k => `<button data-a="prodcat" data-v="${esc(k)}" aria-pressed="${prodCat === k}">${esc(k)}</button>`).join("")}</div>
  <div class="panel tbl-wrap"><table><thead><tr><th>Produk</th><th>Kategori</th><th class="r">Harga</th><th class="r">Modal</th><th class="r">Margin</th><th class="r">Stok</th><th></th></tr></thead><tbody>
  ${list.map(p => { const st = stockOf(p), cost = unitCost(p, id => S.data.products.find(x => x.id === id)), m = p.price ? Math.round((p.price - cost) / p.price * 100) : 0; return `<tr><td><b>${esc(p.name)}</b>${p.ingredient ? ' <span class="pill">bahan</span>' : ""}${p.recipe ? ' <span class="pill ok">resep</span>' : ""}<div class="muted num" style="font-size:.78rem">${esc(p.sku || "")}${p.units ? " · " + p.units.map(x => esc(x.name) + "=" + x.qty).join(", ") : ""}${p.whole ? " · grosir ≥" + p.whole.min : ""}</div></td>
    <td>${esc(p.cat)}</td><td class="r num">${p.ingredient ? "–" : rp(p.price)}</td><td class="r num">${rp(cost)}</td><td class="r num">${p.ingredient ? "–" : m + "%"}</td>
    <td class="r">${st === Infinity ? `<span class="muted">${p.recipe ? "dari resep" : "tidak dilacak"}</span>` : `<span class="pill ${st <= 0 ? "bad" : st <= (p.minStock || 10) ? "gold" : ""}">${nf(st)} ${esc(p.unit || "")}</span>`}${p.recipe && st !== Infinity ? `<div class="muted" style="font-size:.75rem">bisa dibuat ${nf(st)}</div>` : ""}</td>
    <td class="r" style="white-space:nowrap"><button class="btn sm" data-a="editprod" data-id="${p.id}">Ubah</button> <button class="btn sm danger" data-a="delprod" data-id="${p.id}" aria-label="Hapus ${esc(p.name)}">Hapus</button></td></tr>`; }).join("") || `<tr><td colspan="7" class="empty">Belum ada produk.</td></tr>`}
  </tbody></table></div>`;
};
inputs.prodq = el => { prodQ = el.value; render(); };
actions.prodcat = el => { prodCat = el.dataset.v; render(); };
actions.prodscan = () => openCamera(code => { prodQ = code; closeModal(); }, "Cari produk dari barcode");

function prodModal(p) {
  const t = S.tenant, retail = !isFnb(t), units = (p && p.units) || [], recipe = (p && p.recipe) || [];
  const ings = S.data.products.filter(x => x.id !== (p && p.id) && x.track !== false && !x.recipe);
  const st = p ? S.data.stock[p.id] : undefined;
  return () => `<div class="spread"><h2>${p ? "Ubah produk" : "Produk baru"}</h2><button class="btn sm" type="button" data-a="close">Tutup</button></div>
  <form class="stack" data-form="prod" data-id="${p ? p.id : ""}">
    <div class="field"><label for="pn">Nama produk</label><input class="input" id="pn" name="name" required value="${p ? esc(p.name) : ""}"></div>
    <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="pc">Kategori</label><input class="input" id="pc" name="cat" required value="${p ? esc(p.cat) : ""}" placeholder="mis. Kopi, Sembako" list="catlist"><datalist id="catlist">${[...new Set(S.data.products.map(x => x.cat))].map(c => `<option value="${esc(c)}">`).join("")}</datalist></div>
      <div class="field" style="width:110px"><label for="pu">Satuan dasar</label><input class="input" id="pu" name="unit" value="${p ? esc(p.unit || "pcs") : retail ? "pcs" : "porsi"}"></div></div>
    <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="pp">Harga jual</label><input class="input num" id="pp" name="price" type="number" min="0" value="${p ? p.price : ""}" placeholder="0"></div>
      <div class="field" style="flex:1"><label for="pm">Modal per ${p ? esc(p.unit || "pcs") : "satuan"}</label><input class="input num" id="pm" name="cost" type="number" min="0" step="any" value="${p ? p.cost || 0 : ""}" placeholder="0"></div></div>
    <div class="row"><label class="row" style="gap:.35rem"><input type="checkbox" name="track" value="1" ${!p || p.track !== false ? "checked" : ""}> Lacak stok</label>
      <label class="row" style="gap:.35rem"><input type="checkbox" name="ingredient" value="1" ${p && p.ingredient ? "checked" : ""}> Bahan baku (tidak dijual di kasir)</label></div>
    <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="ps">Stok di ${esc(outletName(S.outlet))}</label><input class="input num" id="ps" name="stock" type="number" step="any" value="${st !== undefined ? st : ""}" placeholder="${p ? "" : "0"}"><span class="muted" style="font-size:.78rem">Perubahan tercatat di riwayat stok.</span></div>
      <div class="field" style="flex:1"><label for="pms">Peringatan stok minimum</label><input class="input num" id="pms" name="minStock" type="number" min="0" value="${p && p.minStock ? p.minStock : ""}" placeholder="10"></div></div>
    <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="pb">Barcode</label><div class="row" style="flex-wrap:nowrap"><input class="input num" id="pb" name="sku" value="${p && p.sku ? esc(p.sku) : ""}" placeholder="scan atau ketik"><button class="btn" type="button" data-a="skuscan" data-t="pb" aria-label="Scan barcode">Scan</button></div></div>
      <div class="field" style="flex:1"><label for="pe">Kedaluwarsa</label><input class="input" id="pe" name="exp" type="date" value="${p && p.exp ? isoDay(p.exp) : ""}"></div></div>
    <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="pwm">Grosir mulai (satuan dasar)</label><input class="input num" id="pwm" name="wmin" type="number" min="0" value="${p && p.whole ? p.whole.min : ""}" placeholder="opsional"></div>
      <div class="field" style="flex:1"><label for="pwp">Harga grosir</label><input class="input num" id="pwp" name="wprice" type="number" min="0" value="${p && p.whole ? p.whole.price : ""}"></div></div>
    <details ${units.length ? "open" : ""}><summary style="font-weight:600;cursor:pointer">Satuan bertingkat (pak, dus)</summary>
      <div class="stack" style="gap:.4rem;margin-top:.5rem"><span class="muted" style="font-size:.8rem">Isi = berapa satuan dasar dalam satu kemasan. Stok selalu dihitung dalam satuan dasar.</span>
      ${[0, 1, 2].map(i => { const x = units[i] || {}; return `<div class="row" style="flex-wrap:nowrap;gap:.35rem"><input class="input" name="uname" value="${esc(x.name || "")}" placeholder="${["pak", "dus", "bal"][i]}" aria-label="Nama satuan"><input class="input num" name="uqty" type="number" min="2" value="${x.qty || ""}" placeholder="isi" aria-label="Isi" style="max-width:80px"><input class="input num" name="uprice" type="number" min="0" value="${x.price || ""}" placeholder="harga" aria-label="Harga"><input class="input num" id="usku${i}" name="usku" value="${esc(x.sku || "")}" placeholder="barcode" aria-label="Barcode satuan"></div>`; }).join("")}</div></details>
    <details ${p && p.mods ? "open" : ""}><summary style="font-weight:600;cursor:pointer">Pilihan / varian menu</summary>
      <div class="field" style="margin-top:.5rem"><label for="pmod">Satu baris per pilihan, format "Nama: opsi, opsi"</label><textarea class="input" id="pmod" name="mods" rows="3" placeholder="Gula: Normal, Kurang, Tanpa&#10;Es: Normal, Sedikit">${p && p.mods ? esc(p.mods.map(m => m.name + ": " + m.opts.join(", ")).join("\n")) : ""}</textarea></div></details>
    <details ${recipe.length ? "open" : ""}><summary style="font-weight:600;cursor:pointer">Resep (potong stok bahan baku)</summary>
      <div class="stack" style="gap:.4rem;margin-top:.5rem"><span class="muted" style="font-size:.8rem">Kalau diisi, setiap penjualan mengurangi stok bahan sesuai takaran, bukan stok produk ini.</span>
      ${ings.length ? [0, 1, 2, 3, 4, 5].map(i => { const r = recipe[i] || {}; return `<div class="row" style="flex-wrap:nowrap;gap:.35rem"><select class="input" name="rpid" aria-label="Bahan"><option value="">–</option>${ings.map(x => `<option value="${x.id}" ${r.pid === x.id ? "selected" : ""}>${esc(x.name)} (${esc(x.unit || "pcs")})</option>`).join("")}</select><input class="input num" name="rqty" type="number" min="0" step="any" value="${r.qty || ""}" placeholder="takaran" aria-label="Takaran" style="max-width:110px"></div>`; }).join("") : `<p class="muted" style="font-size:.85rem">Tambahkan dulu produk bahan baku (centang "Bahan baku"), misalnya Biji kopi (gram) atau Susu (ml).</p>`}</div></details>
    <div class="row"><button class="btn primary" type="submit">Simpan</button><button class="btn" type="button" data-a="close">Batal</button></div>
  </form>`;
}
actions.newprod = () => openModal(prodModal(null));
actions.editprod = el => openModal(prodModal(S.data.products.find(p => p.id === el.dataset.id)));
actions.skuscan = el => { const target = el.dataset.t; const saved = S.ui.modal; openCamera(code => { S.ui.modal = saved; render(); const i = document.getElementById(target); if (i) i.value = code; import("./scan.js").then(m => m.stopScanner()); }, "Scan barcode produk"); };
forms.prod = async (d, f) => {
  const units = arr(d.uname).map((n, i) => ({ name: n.trim(), qty: +arr(d.uqty)[i], price: +arr(d.uprice)[i], sku: (arr(d.usku)[i] || "").trim() || undefined })).filter(u => u.name && u.qty > 1);
  const mods = String(d.mods || "").split("\n").map(l => { const [n, o] = l.split(":"); return n && o ? { name: n.trim(), opts: o.split(",").map(s => s.trim()).filter(Boolean) } : null; }).filter(m => m && m.opts.length);
  const recipe = arr(d.rpid).map((pid, i) => ({ pid, qty: +arr(d.rqty)[i] })).filter(r => r.pid && r.qty > 0);
  const id = f.dataset.id || uid("p"), old = S.data.products.find(p => p.id === id) || {};
  const product = { ...old, name: d.name.trim(), cat: d.cat.trim(), unit: (d.unit || "pcs").trim(), price: +d.price || 0, cost: +d.cost || 0, sku: (d.sku || "").trim() || undefined, exp: d.exp ? new Date(d.exp + "T12:00:00").getTime() : undefined,
    whole: +d.wmin > 1 && +d.wprice > 0 ? { min: +d.wmin, price: +d.wprice } : undefined, units, mods, recipe, track: !!d.track, ingredient: !!d.ingredient, minStock: +d.minStock || undefined };
  const r = await api("PUT", "products/" + encodeURIComponent(id), { product, stock: d.stock === "" ? undefined : +d.stock, outlet: S.outlet });
  const i = S.data.products.findIndex(p => p.id === id); if (i >= 0) S.data.products[i] = r.product; else S.data.products.push(r.product);
  if (r.stock !== null && r.stock !== undefined) S.data.stock[id] = r.stock;
  closeModal(); toast("Produk disimpan");
};
actions.delprod = el => { const p = S.data.products.find(p => p.id === el.dataset.id); openModal(`<h2>Hapus ${esc(p.name)}?</h2><p class="muted">Produk hilang dari kasir dan stoknya dihapus di semua outlet. Riwayat transaksi tetap tersimpan.</p><div class="row"><button class="btn danger" data-a="delprodok" data-id="${p.id}">Hapus</button><button class="btn" data-a="close">Batal</button></div>`); };
actions.delprodok = async el => { el.disabled = true; await api("DELETE", "products/" + encodeURIComponent(el.dataset.id)); S.data.products = S.data.products.filter(p => p.id !== el.dataset.id); delete S.data.stock[el.dataset.id]; closeModal(); toast("Produk dihapus"); };

/* ---------- stock ---------- */
const STOCK_TABS = [["level", "Stok"], ["in", "Barang masuk"], ["opname", "Stok opname"], ["transfer", "Transfer"], ["moves", "Riwayat"], ["docs", "Dokumen"], ["suppliers", "Supplier"]];
const ST = () => S.ui.stock || (S.ui.stock = { tab: "level", doc: { items: [], counts: {} }, moves: null, docs: null, pid: "" });
const tracked = () => S.data.products.filter(p => p.track !== false && !p.recipe);
const KIND = { jual: "Penjualan", retur: "Retur/refund", masuk: "Barang masuk", opname: "Stok opname", adjust: "Ubah manual", awal: "Stok awal", "transfer keluar": "Transfer keluar", "transfer masuk": "Transfer masuk" };
views.stock = () => {
  const st = ST(), tabs = STOCK_TABS.filter(([k]) => k !== "transfer" || S.outlets.length > 1);
  return `<div class="spread"><div><h1>Stok</h1><p class="muted">${esc(outletName(S.outlet))}</p></div></div>
  <div class="seg" role="tablist" aria-label="Menu stok">${tabs.map(([k, l]) => `<button data-a="sttab" data-v="${k}" aria-pressed="${st.tab === k}">${l}</button>`).join("")}</div>
  ${({ level: stLevel, in: stIn, opname: stOpname, transfer: stIn, moves: stMoves, docs: stDocs, suppliers: stSuppliers })[st.tab]()}`;
};
actions.sttab = async el => { const st = ST(); st.tab = el.dataset.v; st.doc = { items: [], counts: {} }; render();
  if (st.tab === "moves") await loadMoves(); if (st.tab === "docs") { st.docs = (await api("GET", "stock/docs")).docs; render(); } };
async function loadMoves() { const st = ST(); st.moves = null; render(); st.moves = (await api("GET", "stock/moves?outlet=" + encodeURIComponent(S.outlet) + (st.pid ? "&pid=" + encodeURIComponent(st.pid) : ""))).moves; render(); }
function stLevel() {
  const list = tracked().sort((a, b) => (S.data.stock[a.id] || 0) - (S.data.stock[b.id] || 0));
  const value = list.reduce((s, p) => s + Math.max(0, S.data.stock[p.id] || 0) * (p.cost || 0), 0);
  return `<div class="tiles"><div class="tile"><span class="label">Produk dilacak</span><span class="v">${list.length}</span></div><div class="tile"><span class="label">Nilai stok (modal)</span><span class="v">${rp(value)}</span></div><div class="tile"><span class="label">Stok menipis / habis</span><span class="v">${list.filter(p => (S.data.stock[p.id] || 0) <= (p.minStock || 10)).length}</span></div></div>
  <div class="panel tbl-wrap"><table><thead><tr><th>Produk</th><th class="r">Stok</th><th class="r">Minimum</th><th class="r">Nilai</th><th></th></tr></thead><tbody>
  ${list.map(p => { const s = S.data.stock[p.id] || 0; return `<tr><td><b>${esc(p.name)}</b> <span class="muted" style="font-size:.8rem">${esc(p.cat)}</span></td><td class="r"><span class="pill ${s <= 0 ? "bad" : s <= (p.minStock || 10) ? "gold" : ""}">${nf(s)} ${esc(p.unit || "")}</span></td><td class="r num muted">${p.minStock || 10}</td><td class="r num">${rp(Math.max(0, s) * (p.cost || 0))}</td><td class="r"><button class="btn sm" data-a="stmoves" data-id="${p.id}">Riwayat</button></td></tr>`; }).join("") || `<tr><td colspan="5" class="empty">Belum ada produk yang dilacak stoknya.</td></tr>`}
  </tbody></table></div>`;
}
actions.stmoves = async el => { const st = ST(); st.tab = "moves"; st.pid = el.dataset.id; await loadMoves(); };
function itemPicker() {
  return `<div class="row" style="flex-wrap:nowrap"><select class="input" data-ch="docadd" aria-label="Tambah barang"><option value="">＋ Tambah barang…</option>${tracked().map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select><input class="input" id="docscan" placeholder="atau scan barcode + Enter" style="max-width:220px" autocomplete="off"><button class="btn" type="button" data-a="doccam" aria-label="Scan pakai kamera">Scan</button></div>`;
}
function stIn() {
  const st = ST(), d = st.doc, transfer = st.tab === "transfer";
  const total = d.items.reduce((s, i) => s + (+i.qty || 0) * (+i.cost || 0), 0);
  return `<form class="panel stack" data-form="${transfer ? "sttransfer" : "stin"}">
    <h2>${transfer ? "Pindahkan stok antar outlet" : "Catat barang masuk"}</h2>
    ${transfer ? `<div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><span class="label">Dari</span><b>${esc(outletName(S.outlet))}</b></div><div class="field" style="flex:1"><label for="tfto">Ke outlet</label><select class="input" id="tfto" name="to" required>${S.outlets.filter(o => o.id !== S.outlet).map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></div></div>`
      : `<div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="sisup">Supplier</label><select class="input" id="sisup" name="supplierId"><option value="">Tanpa supplier</option>${S.data.suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></div><div class="field" style="flex:1"><label for="siinv">No. faktur</label><input class="input" id="siinv" name="invoice" placeholder="opsional"></div></div>`}
    ${itemPicker()}
    <div class="tbl-wrap"><table><thead><tr><th>Barang</th><th>Satuan</th><th class="r">Jumlah</th>${transfer ? "" : `<th class="r">Harga beli / satuan</th><th class="r">Subtotal</th>`}<th></th></tr></thead><tbody>
    ${d.items.map((i, k) => { const p = S.data.products.find(x => x.id === i.pid) || {}; return `<tr><td>${esc(p.name)}</td><td><select class="input" data-ch="docunit" data-i="${k}" aria-label="Satuan"><option value="">${esc(p.unit || "pcs")}</option>${(p.units || []).map(u => `<option value="${esc(u.name)}" ${i.unit === u.name ? "selected" : ""}>${esc(u.name)} (isi ${u.qty})</option>`).join("")}</select></td>
      <td class="r"><input class="input num" id="dq${k}" type="number" min="0" step="any" value="${i.qty || ""}" data-in="docqty" data-i="${k}" style="width:90px" aria-label="Jumlah"></td>
      ${transfer ? "" : `<td class="r"><input class="input num" id="dc${k}" type="number" min="0" step="any" value="${i.cost || ""}" data-in="doccost" data-i="${k}" style="width:120px" aria-label="Harga beli"></td><td class="r num">${rp((+i.qty || 0) * (+i.cost || 0))}</td>`}
      <td class="r"><button class="btn sm danger" type="button" data-a="docrm" data-i="${k}" aria-label="Hapus baris">✕</button></td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">Belum ada barang.</td></tr>`}
    </tbody></table></div>
    ${transfer ? "" : `<div class="spread"><label class="row" style="gap:.35rem;font-size:.9rem"><input type="checkbox" name="updateCost" value="1" checked> Perbarui harga modal (rata-rata tertimbang)</label><b class="num">Total ${rp(total)}</b></div>`}
    <div class="field"><label for="dnote">Catatan</label><input class="input" id="dnote" name="note" placeholder="opsional"></div>
    <div><button class="btn primary" type="submit" ${d.items.length ? "" : "disabled"}>${transfer ? "Pindahkan stok" : "Simpan barang masuk"}</button></div></form>`;
}
function docAdd(pid, unit) {
  const d = ST().doc, p = S.data.products.find(x => x.id === pid); if (!p) return;
  const ex = d.items.find(i => i.pid === pid && (i.unit || "") === (unit || ""));
  if (ex) ex.qty = (+ex.qty || 0) + 1; else d.items.push({ pid, unit: unit || "", qty: 1, cost: unit ? (p.cost || 0) * ((p.units || []).find(u => u.name === unit) || { qty: 1 }).qty : p.cost || 0 });
  if (ST().tab === "opname") d.counts[pid] = d.counts[pid] ?? "";
  render();
}
function docScan(code) {
  for (const p of tracked()) { if (p.sku === code) return docAdd(p.id, ""); const u = (p.units || []).find(u => u.sku === code); if (u) return docAdd(p.id, u.name); }
  toast("Barcode " + code + " belum terdaftar");
}
changes.docadd = el => { if (el.value) docAdd(el.value, ""); };
changes.docunit = el => { const i = ST().doc.items[+el.dataset.i], p = S.data.products.find(x => x.id === i.pid); i.unit = el.value; const f = el.value ? (p.units.find(u => u.name === el.value) || { qty: 1 }).qty : 1; i.cost = Math.round((p.cost || 0) * f); render(); };
inputs.docqty = el => { ST().doc.items[+el.dataset.i].qty = el.value; };
inputs.doccost = el => { ST().doc.items[+el.dataset.i].cost = el.value; };
actions.docrm = el => { ST().doc.items.splice(+el.dataset.i, 1); render(); };
actions.doccam = () => openCamera(code => { if (ST().tab === "opname") { const p = tracked().find(p => p.sku === code || (p.units || []).some(u => u.sku === code)); if (p) { ST().opQ = p.name; toast(p.name); } else toast("Barcode belum terdaftar"); } else { docScan(code); toast("+1"); } }, "Scan barang");
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "docscan") { e.preventDefault(); docScan(e.target.value.trim()); const x = document.getElementById("docscan"); if (x) { x.value = ""; x.focus(); } } });
const docBody = d => ({ items: ST().doc.items.map(i => ({ pid: i.pid, unit: i.unit, qty: +i.qty || 0, cost: +i.cost || 0 })), note: d.note, outlet: S.outlet });
forms.stin = async d => {
  const r = await api("POST", "stock/in", { ...docBody(d), supplierId: d.supplierId || undefined, invoice: d.invoice, updateCost: !!d.updateCost });
  S.data.stock = r.stock; ST().doc = { items: [], counts: {} };
  try { await loadData(); } catch (e) {}
  toast("Barang masuk " + r.doc.id + " tersimpan (" + r.doc.items.length + " barang)"); render();
};
forms.sttransfer = async d => {
  const r = await api("POST", "stock/transfer", { ...docBody(d), from: S.outlet, to: d.to });
  for (const i of r.doc.items) S.data.stock[i.pid] = (S.data.stock[i.pid] || 0) - i.qty * i.factor;
  ST().doc = { items: [], counts: {} }; toast("Stok dipindah ke " + r.doc.toName); render();
};
function stOpname() {
  const st = ST(), q = (st.opQ || "").toLowerCase();
  const list = tracked().filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku || "").includes(q));
  const counts = st.doc.counts, filled = Object.entries(counts).filter(([, v]) => v !== "" && v !== undefined);
  return `<form class="panel stack" data-form="stopname"><div class="spread"><h2>Stok opname</h2><span class="muted" style="font-size:.88rem">${filled.length} produk sudah dihitung</span></div>
    <p class="muted" style="font-size:.9rem">Isi jumlah fisik hasil hitung. Produk yang dikosongkan tidak diubah. Selisih langsung menyesuaikan stok dan tercatat sebagai kehilangan atau kelebihan.</p>
    <div class="row" style="flex-wrap:nowrap"><input class="input" id="opq" type="search" data-in="opq" value="${esc(st.opQ || "")}" placeholder="Cari produk" autocomplete="off"><button class="btn" type="button" data-a="doccam">Scan</button></div>
    <div class="tbl-wrap" data-keep-scroll="op" style="max-height:55vh;overflow:auto"><table><thead><tr><th>Produk</th><th class="r">Sistem</th><th class="r">Hitung fisik</th><th class="r">Selisih</th></tr></thead><tbody>
    ${list.map(p => { const sys = S.data.stock[p.id] || 0, v = counts[p.id], diff = v === "" || v === undefined ? null : +v - sys; return `<tr><td>${esc(p.name)}</td><td class="r num">${nf(sys)}</td><td class="r"><input class="input num" id="oc_${p.id}" type="number" step="any" value="${v ?? ""}" data-in="opcount" data-id="${p.id}" style="width:100px" aria-label="Hitung fisik ${esc(p.name)}"></td><td class="r num ${diff === null ? "muted" : diff < 0 ? "down" : diff > 0 ? "up" : ""}" id="od_${p.id}">${diff === null ? "–" : (diff > 0 ? "+" : "") + nf(diff)}</td></tr>`; }).join("")}
    </tbody></table></div>
    <div class="field"><label for="opnote">Catatan</label><input class="input" id="opnote" name="note" placeholder="mis. opname akhir bulan"></div>
    <div><button class="btn primary" type="submit">Simpan hasil opname</button></div></form>`;
}
inputs.opq = el => { ST().opQ = el.value; render(); };
inputs.opcount = el => { const id = el.dataset.id; ST().doc.counts[id] = el.value; const sys = S.data.stock[id] || 0, d = $("#od_" + id); if (d) { const diff = el.value === "" ? null : +el.value - sys; d.textContent = diff === null ? "–" : (diff > 0 ? "+" : "") + nf(diff); d.className = "r num " + (diff === null ? "muted" : diff < 0 ? "down" : diff > 0 ? "up" : ""); } };
forms.stopname = async d => {
  const items = Object.entries(ST().doc.counts).filter(([, v]) => v !== "" && v !== undefined).map(([pid, v]) => ({ pid, counted: +v }));
  if (!items.length) { toast("Isi hasil hitung minimal satu produk"); return; }
  const r = await api("POST", "stock/opname", { items, note: d.note, outlet: S.outlet });
  S.data.stock = r.stock; ST().doc = { items: [], counts: {} };
  toast("Opname tersimpan. Nilai selisih " + rp(r.doc.lossValue)); render();
};
function stMoves() {
  const st = ST(), pm = new Map(S.data.products.map(p => [p.id, p]));
  return `<div class="row" style="flex-wrap:nowrap"><select class="input" data-ch="mvpid" aria-label="Filter produk"><option value="">Semua produk</option>${tracked().map(p => `<option value="${p.id}" ${st.pid === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select><button class="btn" data-a="mvreload">Muat ulang</button></div>
  <div class="panel tbl-wrap"><table><thead><tr><th>Waktu</th><th>Produk</th><th>Jenis</th><th class="r">Jumlah</th><th>Ref</th><th>Oleh</th></tr></thead><tbody>
  ${st.moves === null ? `<tr><td colspan="6" class="empty">Memuat…</td></tr>` : st.moves.map(m => { const p = pm.get(m.pid); const by = S.staff.find(s => s.id === m.userId); return `<tr><td class="num" style="white-space:nowrap">${fmtDT(m.time)}</td><td>${esc(p ? p.name : m.pid)}</td><td>${esc(KIND[m.kind] || m.kind)}${m.note ? `<div class="muted" style="font-size:.78rem">${esc(m.note)}</div>` : ""}</td><td class="r num ${m.qty < 0 ? "down" : "up"}">${m.qty > 0 ? "+" : ""}${nf(m.qty)}</td><td class="num muted" style="font-size:.8rem">${esc(m.ref || "")}</td><td class="muted">${esc(by ? by.name : "")}</td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">Belum ada pergerakan stok 30 hari terakhir.</td></tr>`}
  </tbody></table></div>`;
}
changes.mvpid = el => { ST().pid = el.value; loadMoves(); };
actions.mvreload = () => loadMoves();
function stDocs() {
  const st = ST();
  const label = { in: "Barang masuk", opname: "Stok opname", transfer: "Transfer" };
  return `<div class="panel tbl-wrap"><table><thead><tr><th>Waktu</th><th>No.</th><th>Jenis</th><th>Keterangan</th><th class="r">Barang</th><th class="r">Nilai</th></tr></thead><tbody>
  ${st.docs === null || st.docs === undefined ? `<tr><td colspan="6" class="empty">Memuat…</td></tr>` : st.docs.map(d => `<tr class="click" data-a="docview" data-id="${d.id}"><td class="num">${fmtDT(d.time)}</td><td class="num muted">${esc(d.id)}</td><td>${label[d.kind] || d.kind}</td><td>${d.kind === "in" ? esc((d.supplier ? d.supplier.name : "Tanpa supplier") + (d.invoice ? " · " + d.invoice : "")) : d.kind === "transfer" ? esc(d.fromName + " → " + d.toName) : esc(outletName(d.outletId))}<div class="muted" style="font-size:.78rem">${esc(d.by || "")}${d.note ? " · " + esc(d.note) : ""}</div></td><td class="r num">${d.items.length}</td><td class="r num">${d.kind === "in" ? rp(d.total) : d.kind === "opname" ? rp(d.lossValue) : "–"}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Belum ada dokumen stok 30 hari terakhir.</td></tr>`}
  </tbody></table></div>`;
}
actions.docview = el => {
  const d = ST().docs.find(x => x.id === el.dataset.id);
  openModal(`<div class="spread"><h2>${esc(d.id)}</h2><button class="btn sm" data-a="close">Tutup</button></div><p class="muted">${fmtDT(d.time)} · ${esc(d.by || "")}${d.note ? " · " + esc(d.note) : ""}</p>
  <div class="tbl-wrap"><table><tbody>${d.items.map(i => d.kind === "opname" ? `<tr><td>${esc(i.name)}</td><td class="r num">sistem ${nf(i.system)} → ${nf(i.counted)}</td><td class="r num ${i.diff < 0 ? "down" : "up"}">${i.diff > 0 ? "+" : ""}${nf(i.diff)}</td></tr>` : `<tr><td>${esc(i.name)}</td><td class="r num">${nf(i.qty)} ${esc(i.unit)}</td>${d.kind === "in" ? `<td class="r num">${rp(i.qty * i.cost)}</td>` : ""}</tr>`).join("")}</tbody></table></div>`);
};
function stSuppliers() {
  return `<div class="spread"><p class="muted">Supplier dipakai saat mencatat barang masuk.</p><button class="btn primary" data-a="supnew">Tambah supplier</button></div>
  <div class="panel tbl-wrap"><table><thead><tr><th>Nama</th><th>Telepon</th><th>Alamat</th><th></th></tr></thead><tbody>
  ${S.data.suppliers.map(s => `<tr><td><b>${esc(s.name)}</b>${s.note ? `<div class="muted" style="font-size:.8rem">${esc(s.note)}</div>` : ""}</td><td class="num">${esc(s.phone || "")}</td><td class="muted">${esc(s.address || "")}</td><td class="r" style="white-space:nowrap"><button class="btn sm" data-a="supedit" data-id="${s.id}">Ubah</button> <button class="btn sm danger" data-a="supdel" data-id="${s.id}">Hapus</button></td></tr>`).join("") || `<tr><td colspan="4" class="empty">Belum ada supplier.</td></tr>`}
  </tbody></table></div>`;
}
const supModal = s => `<h2>${s ? "Ubah supplier" : "Supplier baru"}</h2><form class="stack" data-form="sup" data-id="${s ? s.id : ""}">
  <div class="field"><label for="sun">Nama</label><input class="input" id="sun" name="name" required value="${esc(s ? s.name : "")}"></div>
  <div class="field"><label for="sup2">Telepon</label><input class="input" id="sup2" name="phone" inputmode="tel" value="${esc(s ? s.phone || "" : "")}"></div>
  <div class="field"><label for="sua">Alamat</label><input class="input" id="sua" name="address" value="${esc(s ? s.address || "" : "")}"></div>
  <div class="field"><label for="sunt">Catatan</label><input class="input" id="sunt" name="note" value="${esc(s ? s.note || "" : "")}" placeholder="mis. kirim tiap Senin"></div>
  <div class="row"><button class="btn primary" type="submit">Simpan</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`;
actions.supnew = () => openModal(supModal(null));
actions.supedit = el => openModal(supModal(S.data.suppliers.find(s => s.id === el.dataset.id)));
actions.supdel = async el => { if (!confirm("Hapus supplier ini?")) return; await api("DELETE", "suppliers/" + el.dataset.id); S.data.suppliers = S.data.suppliers.filter(s => s.id !== el.dataset.id); render(); };
forms.sup = async (d, f) => { const id = f.dataset.id || uid("s"); const r = await api("PUT", "suppliers/" + id, { supplier: d }); const i = S.data.suppliers.findIndex(s => s.id === id); if (i >= 0) S.data.suppliers[i] = r.supplier; else S.data.suppliers.push(r.supplier); closeModal(); toast("Supplier disimpan"); };

/* ---------- members ---------- */
let custQ = "";
views.customers = (u) => {
  const q = custQ.toLowerCase(), loy = S.settings.loyalty || {};
  const list = S.data.customers.filter(c => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q)).sort((a, b) => (b.spent || 0) - (a.spent || 0));
  return `<div class="spread"><div><h1>Pelanggan & member</h1><p class="muted">${S.data.customers.length} member · poin ${loy.enabled ? `aktif: 1 poin tiap ${rp(loy.earnPer)}, 1 poin = ${rp(loy.pointValue)}` : "belum aktif (atur di Pengaturan)"}</p></div><button class="btn primary" data-a="custnew">Tambah member</button></div>
  <input class="input" id="custlq" type="search" data-in="custlq" value="${esc(custQ)}" placeholder="Cari nama atau nomor HP" autocomplete="off">
  <div class="panel tbl-wrap"><table><thead><tr><th>Nama</th><th>HP</th><th class="r">Kunjungan</th><th class="r">Total belanja</th><th class="r">Poin</th><th></th></tr></thead><tbody>
  ${list.slice(0, 300).map(c => `<tr><td><div class="row" style="flex-wrap:nowrap"><span class="avatar">${initials(c.name)}</span><div><b>${esc(c.name)}</b><div class="muted" style="font-size:.78rem">sejak ${fmtDate(c.joined || Date.now())}</div></div></div></td><td class="num">${esc(c.phone)}</td><td class="r num">${c.visits || 0}</td><td class="r num">${rp(c.spent || 0)}</td><td class="r num"><b>${nf(c.points || 0)}</b></td>
    <td class="r" style="white-space:nowrap"><button class="btn sm" data-a="custedit" data-id="${c.id}">Ubah</button> <a class="btn sm" href="https://wa.me/${esc(c.phone.replace(/^0/, "62"))}" target="_blank" rel="noopener">WA</a>${isMgr(u) ? ` <button class="btn sm danger" data-a="custdel" data-id="${c.id}">Hapus</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Belum ada member.</td></tr>`}
  </tbody></table></div>`;
};
inputs.custlq = el => { custQ = el.value; render(); };
const custModal = c => `<h2>${c ? "Ubah member" : "Member baru"}</h2><form class="stack" data-form="cust" data-id="${c ? c.id : ""}">
  <div class="field"><label for="cn">Nama</label><input class="input" id="cn" name="name" required value="${esc(c ? c.name : "")}"></div>
  <div class="field"><label for="cp">Nomor HP / WhatsApp</label><input class="input" id="cp" name="phone" required inputmode="tel" value="${esc(c ? c.phone : "")}"></div>
  <div class="field"><label for="ce">Email</label><input class="input" id="ce" name="email" type="email" value="${esc(c ? c.email || "" : "")}" placeholder="opsional"></div>
  <div class="field"><label for="cnt">Catatan</label><input class="input" id="cnt" name="note" value="${esc(c ? c.note || "" : "")}" placeholder="mis. alergi kacang"></div>
  ${isMgr(me()) ? `<div class="field"><label for="cpt">Poin</label><input class="input num" id="cpt" name="points" type="number" min="0" value="${c ? c.points || 0 : 0}"></div>` : ""}
  <div class="row"><button class="btn primary" type="submit">Simpan</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`;
actions.custnew = () => openModal(custModal(null));
actions.custedit = el => openModal(custModal(S.data.customers.find(c => c.id === el.dataset.id)));
actions.custdel = async el => { if (!confirm("Hapus member ini? Poinnya ikut hilang.")) return; await api("DELETE", "customers/" + el.dataset.id); S.data.customers = S.data.customers.filter(c => c.id !== el.dataset.id); render(); };
forms.cust = async (d, f) => { const id = f.dataset.id || uid("c"); const r = await api("PUT", "customers/" + id, d); const i = S.data.customers.findIndex(c => c.id === id); if (i >= 0) S.data.customers[i] = r.customer; else S.data.customers.push(r.customer); closeModal(); toast("Member disimpan"); };

/* ---------- promos & vouchers ---------- */
const promoDesc = p => (p.type === "pct" ? p.value + "%" : rp(p.value)) + (p.maxDisc ? " maks " + rp(p.maxDisc) : "") + (p.scope === "category" ? " untuk kategori " + p.target : p.scope === "product" ? " untuk " + ((S.data.products.find(x => x.id === p.target) || {}).name || "produk") : " semua produk") + (p.minSpend ? ", min. belanja " + rp(p.minSpend) : "");
const promoState = p => { const now = Date.now(); if (!p.active) return ["nonaktif", "bad"]; if (p.start && now < p.start) return ["terjadwal", "gold"]; if (p.end && now > p.end) return ["berakhir", "bad"]; if (p.kind === "voucher" && p.quota && (p.used || 0) >= p.quota) return ["kuota habis", "bad"]; return ["aktif", "ok"]; };
views.promos = () => {
  const row = p => { const [s, c] = promoState(p); return `<tr><td><b>${esc(p.kind === "voucher" ? p.code : p.name)}</b>${p.kind === "voucher" ? `<div class="muted" style="font-size:.8rem">${esc(p.name)}</div>` : ""}</td><td>${esc(promoDesc(p))}</td><td class="num muted" style="font-size:.85rem">${p.start ? fmtDate(p.start) : "–"} s/d ${p.end ? fmtDate(p.end) : "–"}</td>${p.kind === "voucher" ? `<td class="r num">${p.used || 0}${p.quota ? " / " + p.quota : ""}</td>` : ""}<td><span class="pill ${c}">${s}</span></td><td class="r" style="white-space:nowrap"><button class="btn sm" data-a="promoedit" data-id="${p.id}">Ubah</button> <button class="btn sm danger" data-a="promodel" data-id="${p.id}">Hapus</button></td></tr>`; };
  const promos = S.data.promos.filter(p => p.kind !== "voucher"), vouchers = S.data.promos.filter(p => p.kind === "voucher");
  return `<div><h1>Promo & voucher</h1><p class="muted">Promo otomatis langsung memotong harga di kasir (dipilih yang paling menguntungkan pelanggan). Voucher dipakai dengan memasukkan kode.</p></div>
  <div class="panel stack"><div class="spread"><h2>Promo otomatis</h2><button class="btn primary" data-a="promonew" data-v="promo">Tambah promo</button></div><div class="tbl-wrap"><table><thead><tr><th>Nama</th><th>Potongan</th><th>Periode</th><th>Status</th><th></th></tr></thead><tbody>${promos.map(row).join("") || `<tr><td colspan="5" class="empty">Belum ada promo.</td></tr>`}</tbody></table></div></div>
  <div class="panel stack"><div class="spread"><h2>Voucher</h2><button class="btn primary" data-a="promonew" data-v="voucher">Tambah voucher</button></div><div class="tbl-wrap"><table><thead><tr><th>Kode</th><th>Potongan</th><th>Periode</th><th class="r">Terpakai</th><th>Status</th><th></th></tr></thead><tbody>${vouchers.map(row).join("") || `<tr><td colspan="6" class="empty">Belum ada voucher.</td></tr>`}</tbody></table></div></div>`;
};
function promoModal(p, kind) {
  kind = p ? p.kind : kind; const v = kind === "voucher";
  const cats = [...new Set(S.data.products.map(x => x.cat))];
  return `<h2>${p ? "Ubah" : "Tambah"} ${v ? "voucher" : "promo"}</h2><form class="stack" data-form="promo" data-id="${p ? p.id : ""}" data-kind="${kind}">
  <div class="field"><label for="prn">Nama</label><input class="input" id="prn" name="name" required value="${esc(p ? p.name : "")}" placeholder="${v ? "mis. Voucher pelanggan baru" : "mis. Happy hour kopi"}"></div>
  ${v ? `<div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="prc">Kode</label><input class="input" id="prc" name="code" required value="${esc(p ? p.code : "")}" style="text-transform:uppercase" placeholder="HEMAT10"></div><div class="field" style="flex:1"><label for="prq">Kuota pemakaian</label><input class="input num" id="prq" name="quota" type="number" min="0" value="${p && p.quota ? p.quota : ""}" placeholder="tanpa batas"></div></div>` : ""}
  <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="prt">Jenis potongan</label><select class="input" id="prt" name="type"><option value="pct" ${!p || p.type === "pct" ? "selected" : ""}>Persen (%)</option><option value="amount" ${p && p.type === "amount" ? "selected" : ""}>Nominal (Rp)</option></select></div>
    <div class="field" style="flex:1"><label for="prv">Besar potongan</label><input class="input num" id="prv" name="value" type="number" min="0" required value="${p ? p.value : ""}"></div>
    <div class="field" style="flex:1"><label for="prx">Maks. potongan</label><input class="input num" id="prx" name="maxDisc" type="number" min="0" value="${p && p.maxDisc ? p.maxDisc : ""}" placeholder="opsional"></div></div>
  <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="prs">Berlaku untuk</label><select class="input" id="prs" name="scope"><option value="all">Semua produk</option><option value="category" ${p && p.scope === "category" ? "selected" : ""}>Satu kategori</option><option value="product" ${p && p.scope === "product" ? "selected" : ""}>Satu produk</option></select></div>
    <div class="field" style="flex:1.4"><label for="prtg">Kategori / produk</label><select class="input" id="prtg" name="target"><option value="">–</option><optgroup label="Kategori">${cats.map(c => `<option value="${esc(c)}" ${p && p.scope === "category" && p.target === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</optgroup><optgroup label="Produk">${S.data.products.filter(x => !x.ingredient).map(x => `<option value="${x.id}" ${p && p.scope === "product" && p.target === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</optgroup></select></div></div>
  <div class="field"><label for="prm">Minimal belanja</label><input class="input num" id="prm" name="minSpend" type="number" min="0" value="${p && p.minSpend ? p.minSpend : ""}" placeholder="0"></div>
  <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="prst">Mulai</label><input class="input" id="prst" name="start" type="date" value="${p && p.start ? isoDay(p.start) : ""}"></div><div class="field" style="flex:1"><label for="pren">Berakhir</label><input class="input" id="pren" name="end" type="date" value="${p && p.end ? isoDay(p.end) : ""}"></div></div>
  <label class="row" style="gap:.35rem"><input type="checkbox" name="active" value="1" ${!p || p.active ? "checked" : ""}> Aktif</label>
  <div class="row"><button class="btn primary" type="submit">Simpan</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`;
}
actions.promonew = el => openModal(promoModal(null, el.dataset.v));
actions.promoedit = el => openModal(promoModal(S.data.promos.find(p => p.id === el.dataset.id)));
actions.promodel = async el => { if (!confirm("Hapus promo/voucher ini?")) return; await api("DELETE", "promos/" + el.dataset.id); S.data.promos = S.data.promos.filter(p => p.id !== el.dataset.id); render(); };
forms.promo = async (d, f) => {
  const id = f.dataset.id || uid("pr");
  const promo = { kind: f.dataset.kind, name: d.name, code: d.code, quota: +d.quota || undefined, type: d.type, value: +d.value, maxDisc: +d.maxDisc || undefined, scope: d.scope, target: d.scope === "all" ? undefined : d.target, minSpend: +d.minSpend || 0, start: dateTs(d.start), end: dateTs(d.end, true), active: !!d.active };
  if (promo.scope !== "all" && !promo.target) { toast("Pilih kategori atau produknya"); return; }
  const r = await api("PUT", "promos/" + id, { promo });
  const i = S.data.promos.findIndex(p => p.id === id); if (i >= 0) S.data.promos[i] = r.promo; else S.data.promos.push(r.promo);
  closeModal(); toast("Tersimpan");
};

/* ---------- staff ---------- */
views.staff = () => {
  const multi = S.outlets.length > 1;
  return `<div class="spread"><div><h1>Staf</h1><p class="muted">${S.staff.filter(s => s.role !== "owner").length} staf · tanpa batas</p></div><button class="btn primary" data-a="newstaff">Tambah staf</button></div>
  <div class="panel tbl-wrap"><table><thead><tr><th>Nama</th><th>Email</th><th>Peran</th>${multi ? "<th>Outlet</th>" : ""}<th>PIN</th><th></th></tr></thead><tbody>
  ${S.staff.map(s => `<tr><td><div class="row" style="flex-wrap:nowrap"><span class="avatar">${initials(s.name)}</span><b>${esc(s.name)}</b></div></td><td class="muted">${esc(s.email)}</td><td><span class="pill ${s.role === "owner" ? "gold" : s.role === "manager" ? "ok" : ""}">${ROLE[s.role]}</span></td>${multi ? `<td>${s.outletId ? esc(outletName(s.outletId)) : '<span class="muted">semua</span>'}</td>` : ""}<td>${s.role === "cashier" ? '<span class="muted">–</span>' : s.hasPin ? '<span class="pill ok">ada</span>' : '<span class="pill gold">belum</span>'}</td>
    <td class="r" style="white-space:nowrap">${s.role !== "owner" ? `<button class="btn sm" data-a="editstaff" data-id="${s.id}">Ubah</button> <button class="btn sm danger" data-a="delstaff" data-id="${s.id}">Hapus</button>` : ""}</td></tr>`).join("")}
  </tbody></table></div>
  <div class="panel stack"><h2>Hak akses per peran</h2><div class="tbl-wrap"><table><thead><tr><th>Fitur</th><th>Pemilik Usaha</th><th>Manajer</th><th>Kasir</th></tr></thead><tbody>
  ${[["Jualan, meja, dapur, shift", "✓", "✓", "✓"], ["Lihat transaksi", "Semua", "Semua", "Milik sendiri"], ["Setujui refund / batal (PIN)", "✓", "✓", "–"], ["Produk, stok, supplier, promo", "✓", "✓", "–"], ["Dasbor & laporan laba", "✓", "✓", "–"], ["Staf, outlet, pengaturan", "✓", "–", "–"], ["Langganan & tagihan", "✓", "–", "–"]].map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("")}
  </tbody></table></div></div>`;
};
const outletOpts = sel => `<option value="">Semua outlet</option>${S.outlets.map(o => `<option value="${o.id}" ${sel === o.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}`;
actions.newstaff = () => openModal(`<h2>Tambah staf</h2><form class="stack" data-form="staff">
  <div class="field"><label for="sn">Nama</label><input class="input" id="sn" name="name" required></div>
  <div class="field"><label for="se">Email</label><input class="input" id="se" name="email" type="email" autocomplete="off" required></div>
  <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="sr">Peran</label><select class="input" id="sr" name="role"><option value="cashier">Kasir</option><option value="manager">Manajer</option></select></div>
  ${S.outlets.length > 1 ? `<div class="field" style="flex:1"><label for="so">Outlet</label><select class="input" id="so" name="outletId">${outletOpts("")}</select></div>` : ""}</div>
  <div class="field"><label for="sp">Kata sandi awal</label><input class="input" id="sp" name="password" type="password" autocomplete="new-password" minlength="8" required><span class="muted" style="font-size:.8rem">Minimal 8 karakter. Staf bisa menggantinya sendiri di menu Akun.</span></div>
  <div class="row"><button class="btn primary" type="submit">Tambah</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`);
forms.staff = async d => { const r = await api("POST", "staff", d); S.staff.push(r.user); closeModal(); toast(d.name + " ditambahkan sebagai " + ROLE[d.role]); };
actions.editstaff = el => { const s = S.staff.find(x => x.id === el.dataset.id); openModal(`<h2>Ubah ${esc(s.name)}</h2><form class="stack" data-form="editstaff" data-id="${s.id}">
  <div class="field"><label for="esn">Nama</label><input class="input" id="esn" name="name" required value="${esc(s.name)}"></div>
  <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="esr">Peran</label><select class="input" id="esr" name="role"><option value="cashier" ${s.role === "cashier" ? "selected" : ""}>Kasir</option><option value="manager" ${s.role === "manager" ? "selected" : ""}>Manajer</option></select></div>
  ${S.outlets.length > 1 ? `<div class="field" style="flex:1"><label for="eso">Outlet</label><select class="input" id="eso" name="outletId">${outletOpts(s.outletId)}</select></div>` : ""}</div>
  <div class="field"><label for="esp">Kata sandi baru</label><input class="input" id="esp" name="password" type="password" autocomplete="new-password" minlength="8" placeholder="kosongkan kalau tidak diganti"><span class="muted" style="font-size:.8rem">Mengganti kata sandi mengeluarkan staf dari semua perangkat.</span></div>
  <div class="row"><button class="btn primary" type="submit">Simpan</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`); };
forms.editstaff = async (d, f) => { const body = { name: d.name, role: d.role, outletId: d.outletId === undefined ? undefined : d.outletId || null, password: d.password || undefined }; const r = await api("POST", "staff/" + f.dataset.id, body); const i = S.staff.findIndex(x => x.id === f.dataset.id); S.staff[i] = r.user; closeModal(); toast("Staf diperbarui"); };
actions.delstaff = el => { const s = S.staff.find(x => x.id === el.dataset.id); openModal(`<h2>Hapus ${esc(s.name)}?</h2><p class="muted">Akun ini tidak bisa masuk lagi. Riwayat transaksinya tetap tersimpan.</p><div class="row"><button class="btn danger" data-a="delstaffok" data-id="${s.id}">Hapus</button><button class="btn" data-a="close">Batal</button></div>`); };
actions.delstaffok = async el => { el.disabled = true; await api("DELETE", "staff/" + encodeURIComponent(el.dataset.id)); S.staff = S.staff.filter(x => x.id !== el.dataset.id); closeModal(); toast("Staf dihapus"); };

/* ---------- outlets ---------- */
views.outlets = () => `<div class="spread"><div><h1>Outlet</h1><p class="muted">Setiap outlet punya stok, meja, dapur, dan laporan sendiri. Produk dan harga dipakai bersama.</p></div><button class="btn primary" data-a="outletnew">Tambah outlet</button></div>
  <div class="panel tbl-wrap"><table><thead><tr><th>Nama</th><th>Alamat</th><th>Telepon</th><th class="r">Staf</th><th></th></tr></thead><tbody>
  ${S.outlets.map(o => `<tr><td><b>${esc(o.name)}</b>${o.id === "main" ? ' <span class="pill">utama</span>' : ""}${o.id === S.outlet ? ' <span class="pill ok">sedang dibuka</span>' : ""}</td><td class="muted">${esc(o.address || "")}</td><td class="num">${esc(o.phone || "")}</td><td class="r num">${S.staff.filter(s => s.outletId === o.id).length}</td>
    <td class="r" style="white-space:nowrap">${o.id !== S.outlet ? `<button class="btn sm" data-a="outletgo" data-id="${o.id}">Buka</button> ` : ""}<button class="btn sm" data-a="outletedit" data-id="${o.id}">Ubah</button>${o.id !== "main" ? ` <button class="btn sm danger" data-a="outletdel" data-id="${o.id}">Hapus</button>` : ""}</td></tr>`).join("")}
  </tbody></table></div>`;
const outletModal = o => `<h2>${o ? "Ubah outlet" : "Outlet baru"}</h2><form class="stack" data-form="outlet" data-id="${o ? o.id : ""}">
  <div class="field"><label for="otn">Nama outlet</label><input class="input" id="otn" name="name" required value="${esc(o ? o.name : "")}" placeholder="mis. Cabang Dago"></div>
  <div class="field"><label for="ota">Alamat (tampil di struk)</label><input class="input" id="ota" name="address" value="${esc(o ? o.address || "" : "")}"></div>
  <div class="field"><label for="otp">Telepon</label><input class="input" id="otp" name="phone" inputmode="tel" value="${esc(o ? o.phone || "" : "")}"></div>
  ${o ? "" : `<p class="muted" style="font-size:.85rem">Stok outlet baru mulai dari nol. Isi lewat Transfer dari outlet lain atau Barang masuk.</p>`}
  <div class="row"><button class="btn primary" type="submit">Simpan</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`;
actions.outletnew = () => openModal(outletModal(null));
actions.outletedit = el => openModal(outletModal(S.outlets.find(o => o.id === el.dataset.id)));
actions.outletgo = async el => { const { setOutlet } = await import("./core.js"); setOutlet(el.dataset.id); await loadData(); render(); toast("Sekarang membuka " + outletName(el.dataset.id)); };
actions.outletdel = async el => { if (!confirm("Hapus outlet ini? Data transaksinya tetap ada di laporan.")) return; await api("DELETE", "outlets/" + el.dataset.id); S.outlets = S.outlets.filter(o => o.id !== el.dataset.id); if (S.outlet === el.dataset.id) { S.outlet = "main"; await loadData(); } render(); };
forms.outlet = async (d, f) => { const id = f.dataset.id || uid("o"); const r = await api("PUT", "outlets/" + id, d); const i = S.outlets.findIndex(o => o.id === id); if (i >= 0) S.outlets[i] = r.outlet; else S.outlets.push(r.outlet); closeModal(); toast("Outlet disimpan"); };

/* ---------- settings ---------- */
views.settings = (u, t) => {
  const s = S.settings, trial = t.access === "trial", loy = s.loyalty || {}, mt = s.midtrans || {};
  const tablesText = (s.tables || []).map(x => x.name + (x.area && x.area !== "Dalam" ? ", " + x.area : "")).join("\n");
  return `<div><h1>Pengaturan</h1><p class="muted">Data usaha, struk, pajak, meja, poin member, dan pembayaran QRIS.</p></div>
  <form class="panel stack" data-form="setbiz"><h2>Usaha & struk</h2>
    <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:2"><label for="sbn">Nama usaha</label><input class="input" id="sbn" name="name" required value="${esc(t.name)}"></div><div class="field" style="flex:1"><span class="label">Jenis</span><b>${esc(t.type)}</b></div></div>
    <div class="field"><label for="sba">Alamat di struk</label><input class="input" id="sba" name="address" value="${esc(s.address || "")}" placeholder="${esc(t.city)}"></div>
    <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="sbp">Telepon di struk</label><input class="input" id="sbp" name="phone" value="${esc(s.phone || "")}"></div><div class="field" style="flex:2"><label for="sbf">Pesan penutup struk</label><input class="input" id="sbf" name="receiptFooter" value="${esc(s.receiptFooter || "")}" placeholder="Terima kasih"></div></div>
    <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="sbt">Pajak PB1/PPN (%)</label><input class="input num" id="sbt" name="tax" type="number" min="0" max="30" step="0.5" value="${t.tax}"></div><div class="field" style="flex:1"><label for="sbs">Service charge (%)</label><input class="input num" id="sbs" name="service" type="number" min="0" max="30" step="0.5" value="${s.service || 0}"></div></div>
    <label class="row" style="gap:.35rem"><input type="checkbox" name="requireShift" value="1" ${s.requireShift ? "checked" : ""}> Wajib buka shift (modal kas) sebelum kasir menerima pembayaran</label>
    <div><button class="btn primary" type="submit">Simpan</button></div></form>
  <form class="panel stack" data-form="settables"><h2>Meja</h2><p class="muted" style="font-size:.9rem">Satu baris per meja, format "nama, area". Contoh: "5, Teras". Isi "1-10, Dalam" untuk membuat meja 1 sampai 10 sekaligus.</p>
    <textarea class="input num" name="tables" rows="6">${esc(tablesText)}</textarea><div><button class="btn primary" type="submit">Simpan meja (${(s.tables || []).length})</button></div></form>
  <form class="panel stack" data-form="setloy"><h2>Poin member</h2>
    <label class="row" style="gap:.35rem"><input type="checkbox" name="enabled" value="1" ${loy.enabled ? "checked" : ""}> Aktifkan poin member</label>
    <div class="row" style="flex-wrap:nowrap"><div class="field" style="flex:1"><label for="sle">Dapat 1 poin setiap belanja (Rp)</label><input class="input num" id="sle" name="earnPer" type="number" min="1000" value="${loy.earnPer || 10000}"></div><div class="field" style="flex:1"><label for="slv">Nilai 1 poin saat ditukar (Rp)</label><input class="input num" id="slv" name="pointValue" type="number" min="1" value="${loy.pointValue || 100}"></div></div>
    <div><button class="btn primary" type="submit">Simpan</button></div></form>
  <form class="panel stack" data-form="setmt"><div class="spread"><h2>QRIS otomatis (Midtrans)</h2><span class="pill ${mt.configured ? "ok" : ""}">${mt.configured ? "tersambung" + (mt.production ? "" : " · sandbox") : "belum diatur"}</span></div>
    <p class="muted" style="font-size:.9rem">Dengan akun Midtrans milik usahamu, kasir bisa membuat QRIS sesuai total belanja dan pembayaran terkonfirmasi otomatis. Dana masuk langsung ke rekening Midtrans-mu. Ambil Server Key di dashboard Midtrans, menu Settings, Access Keys. Atur juga Payment Notification URL ke <code>${esc(location.origin)}/api/midtrans/notify</code>.</p>
    <div class="field"><label for="smk">Server Key</label><input class="input num" id="smk" name="serverKey" type="password" autocomplete="off" placeholder="${mt.configured ? "tersimpan, isi untuk mengganti" : "Mid-server-…"}"></div>
    <label class="row" style="gap:.35rem"><input type="checkbox" name="production" value="1" ${mt.production ? "checked" : ""}> Mode produksi (bukan sandbox)</label>
    <div class="row"><button class="btn primary" type="submit">Simpan</button>${mt.configured ? `<button class="btn danger" type="button" data-a="mtclear">Putuskan</button>` : ""}</div></form>
  <div class="panel stack" style="border-color:var(--bad)"><h2>Kosongkan data</h2>
    <p class="muted" style="font-size:.92rem">Hapus semua produk, stok, transaksi, member, promo, dan shift supaya kamu bisa mulai dari nol setelah mencoba-coba. Akun usaha, outlet, dan staf tetap ada. Tindakan ini tidak bisa dibatalkan.</p>
    ${trial ? `<div><button class="btn danger" data-a="resetask">Kosongkan data</button></div>` : `<p class="muted" style="font-size:.85rem">Hanya tersedia selama masa coba.</p>`}</div>`;
};
async function saveSettings(settings, msg) {
  const r = await api("PUT", "settings", { settings, ...(settings.tax !== undefined ? { } : {}) });
  S.settings = r.settings; S.tenant = { ...S.tenant, ...r.tenant }; render(); toast(msg || "Pengaturan disimpan");
}
forms.setbiz = d => saveSettings({ name: d.name, address: d.address, phone: d.phone, receiptFooter: d.receiptFooter, tax: +d.tax || 0, service: +d.service || 0, requireShift: !!d.requireShift });
forms.settables = d => {
  const tables = [];
  for (const line of String(d.tables || "").split("\n")) {
    const [n, a] = line.split(",").map(s => s.trim()); if (!n) continue;
    const m = n.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) for (let i = +m[1]; i <= Math.min(+m[2], +m[1] + 199); i++) tables.push({ id: "m" + tables.length, name: String(i), area: a || "Dalam" });
    else tables.push({ id: "m" + tables.length, name: n, area: a || "Dalam" });
  }
  return saveSettings({ tables }, tables.length + " meja disimpan");
};
forms.setloy = d => saveSettings({ loyalty: { enabled: !!d.enabled, earnPer: +d.earnPer, pointValue: +d.pointValue } });
forms.setmt = d => saveSettings({ midtrans: { ...(d.serverKey ? { serverKey: d.serverKey.trim() } : {}), production: !!d.production } }, "Pengaturan Midtrans disimpan");
actions.mtclear = () => saveSettings({ midtrans: { serverKey: "", clientKey: "" } }, "Midtrans diputus");
actions.resetask = () => openModal(`<h2>Kosongkan semua data?</h2><p class="muted">${S.data.products.length} produk, ${S.data.transactions.length} transaksi, dan ${S.data.customers.length} member akan dihapus permanen. Ketik <b>KOSONGKAN</b> untuk melanjutkan.</p>
  <form class="stack" data-form="reset"><input class="input" name="confirm" autocomplete="off" required placeholder="KOSONGKAN"><div class="row"><button class="btn danger" type="submit">Kosongkan data</button><button class="btn" type="button" data-a="close">Batal</button></div></form>`);
forms.reset = async d => { if (d.confirm.trim().toUpperCase() !== "KOSONGKAN") { toast("Ketik KOSONGKAN untuk konfirmasi"); return; } await api("POST", "settings/reset"); S.ui.modal = null; await boot({ quiet: true }); toast("Data usaha dikosongkan"); };
void isRetail;

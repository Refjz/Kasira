// Kasvara order pricing. Shared by the browser (cart preview) and the API (authoritative totals),
// so the cashier screen and the stored transaction always agree on the same rules.

export const lineKey = l => [l.pid, l.unit || "", l.mods ? JSON.stringify(l.mods) : ""].join("|");

// Unit lookup: products sell in a base unit (factor 1) and optional larger units (pak, dus) with their own price.
export function unitOf(p, unitName) {
  if (unitName && Array.isArray(p.units)) {
    const u = p.units.find(u => u.name === unitName);
    if (u) return { name: u.name, factor: Math.max(1, +u.qty || 1), price: +u.price || 0 };
  }
  return { name: p.unit || "pcs", factor: 1, price: +p.price || 0, base: true };
}

const inWindow = (x, now) => x.active !== false && (!x.start || x.start <= now) && (!x.end || x.end >= now);

function promoAmount(promo, lines, subtotal) {
  if (subtotal < (+promo.minSpend || 0)) return 0;
  const scope = promo.scope || "all";
  const base = scope === "all" ? subtotal
    : lines.filter(l => scope === "category" ? l.cat === promo.target : l.pid === promo.target).reduce((s, l) => s + l.amount, 0);
  if (!base) return 0;
  const v = promo.type === "amount" ? Math.min(+promo.value || 0, base) : Math.round(base * Math.min(Math.max(+promo.value || 0, 0), 100) / 100);
  return Math.min(v, +promo.maxDisc || Infinity);
}

// Cost per base unit; recipe items cost the sum of their ingredients.
export function unitCost(p, get) {
  if (Array.isArray(p.recipe) && p.recipe.length) return p.recipe.reduce((s, r) => { const i = get(r.pid); return s + (i ? (+i.cost || 0) * (+r.qty || 0) : 0); }, 0);
  return +p.cost || 0;
}

/**
 * Price an order.
 * input: { lines:[{pid, qty, unit, mods}], discPct, voucherCode, redeemPoints }
 * ctx:   { products: Map|obj by id, tax, service, promos:[], loyalty:{enabled, earnPer, pointValue}, customer, now }
 */
export function priceOrder(input, ctx) {
  const now = ctx.now || Date.now();
  const get = id => ctx.products instanceof Map ? ctx.products.get(id) : ctx.products[id];
  const raw = (input.lines || []).map(l => ({ ...l, qty: Math.max(0, Math.floor(+l.qty || 0)) })).filter(l => l.qty > 0 && get(l.pid));

  // Wholesale price applies when the base-unit quantity of a product reaches its threshold.
  const baseQty = {};
  for (const l of raw) { const p = get(l.pid); if (unitOf(p, l.unit).base) baseQty[p.id] = (baseQty[p.id] || 0) + l.qty; }

  const lines = raw.map(l => {
    const p = get(l.pid), u = unitOf(p, l.unit);
    const wholesale = !!(u.base && p.whole && +p.whole.min > 1 && baseQty[p.id] >= +p.whole.min);
    const price = wholesale ? +p.whole.price : u.price;
    return {
      key: lineKey({ pid: p.id, unit: u.base ? "" : u.name, mods: l.mods }), pid: p.id, name: p.name, cat: p.cat, qty: l.qty,
      unit: u.base ? "" : u.name, unitLabel: u.name, factor: u.factor, price, listPrice: u.price, cost: Math.round(unitCost(p, get) * u.factor),
      wholesale, mods: l.mods || null, note: l.note ? String(l.note).slice(0, 120) : undefined, amount: price * l.qty
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const saved = lines.reduce((s, l) => s + (l.listPrice - l.price) * l.qty, 0);

  // Best single automatic promo.
  let promo = null;
  for (const pr of (ctx.promos || [])) {
    if (pr.kind !== "promo" || !inWindow(pr, now)) continue;
    const a = promoAmount(pr, lines, subtotal);
    if (a > 0 && (!promo || a > promo.amount)) promo = { id: pr.id, name: pr.name, amount: a };
  }
  let left = subtotal - (promo ? promo.amount : 0);

  const discPct = Math.min(Math.max(+input.discPct || 0, 0), 100);
  const manual = Math.round(left * discPct / 100);
  left -= manual;

  let voucher = null, voucherError = null;
  if (input.voucherCode) {
    const code = String(input.voucherCode).trim().toUpperCase();
    const v = (ctx.promos || []).find(x => x.kind === "voucher" && String(x.code || "").toUpperCase() === code);
    if (!v || !inWindow(v, now)) voucherError = "Kode voucher tidak berlaku";
    else if (v.quota && (+v.used || 0) >= +v.quota) voucherError = "Kuota voucher sudah habis";
    else if (subtotal < (+v.minSpend || 0)) voucherError = "Belanja minimal " + (+v.minSpend).toLocaleString("id-ID") + " untuk voucher ini";
    else { const a = Math.min(promoAmount({ ...v, scope: v.scope || "all", minSpend: 0 }, lines, left), left); if (a > 0) voucher = { id: v.id, code, name: v.name, amount: a }; }
    if (voucher) left -= voucher.amount;
  }

  const loyalty = ctx.loyalty || {};
  let pointsRedeemed = 0, pointsValue = 0;
  if (loyalty.enabled && ctx.customer && +input.redeemPoints > 0) {
    const pv = Math.max(1, +loyalty.pointValue || 100);
    pointsRedeemed = Math.min(Math.floor(+input.redeemPoints), Math.floor(+ctx.customer.points || 0), Math.floor(left / pv));
    pointsValue = pointsRedeemed * pv;
    left -= pointsValue;
  }

  const discount = subtotal - left;
  const service = Math.round(left * (+ctx.service || 0) / 100);
  const tax = Math.round((left + service) * (+ctx.tax || 0) / 100);
  const total = left + service + tax;
  const pointsEarned = loyalty.enabled && ctx.customer ? Math.floor(total / Math.max(1, +loyalty.earnPer || 10000)) : 0;
  return { lines, subtotal, saved, promo, discPct, manual, voucher, voucherError, pointsRedeemed, pointsValue, discount, service, tax, total, pointsEarned };
}

// Stock effect of selling `qty` of a line: recipe ingredients, or the product itself when tracked.
export function stockEffects(p, factor, qty, getProduct) {
  const out = [];
  if (Array.isArray(p.recipe) && p.recipe.length) {
    for (const r of p.recipe) { const ing = getProduct(r.pid); if (ing && ing.track !== false) out.push({ pid: ing.id, qty: (+r.qty || 0) * factor * qty }); }
  } else if (p.track !== false) out.push({ pid: p.id, qty: factor * qty });
  return out;
}

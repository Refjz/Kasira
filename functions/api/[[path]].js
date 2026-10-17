// Kasvara POS API: Cloudflare Pages Function backed by D1 (binding DB).
// Auth uses PBKDF2 password hashes and an HttpOnly session cookie.
// Env: DB (D1), OWNER_EMAIL (secret; the only email that may claim the app-owner account),
// optional MIDTRANS_SERVER_KEY + MIDTRANS_PRODUCTION (subscription checkout),
// optional RESEND_API_KEY + MAIL_FROM (password-reset email).
import { priceOrder, stockEffects, lineKey } from "../../public/app/pricing.js";

const DAY = 86400000;
const TRIAL_DAYS = 7;
const SESSION_DAYS = 30;
// Every plan has all features; plans differ only in billing period.
const PLANS = { bulanan: { name: "Bulanan", price: 99000, days: 30 }, tahunan: { name: "Tahunan", price: 990000, days: 365 } };
const planKey = k => PLANS[k] ? k : "bulanan";
// Prices are set by the app owner in the console; defaults apply until then.
async function getPlans(env) {
  const r = await env.DB.prepare("SELECT data FROM platform WHERE key = 'plans'").first().catch(() => null);
  const saved = r ? parse(r.data) : {};
  return Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, { ...p, price: saved[k] && +saved[k].price > 0 ? Math.round(+saved[k].price) : p.price }]));
}
const STAFF_ROLES = ["manager", "cashier"];
const MANAGERS = ["owner", "manager"];
const TYPES = ["F&B", "Minimarket", "Retail", "Jasa"];
const METHODS = ["Tunai", "QRIS", "Kartu Debit", "Kartu Kredit", "Transfer", "E-Wallet"];
const MAIN = "main";

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const newId = p => p + randHex(6);
const sha256 = async s => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const sha512 = async s => hex(await crypto.subtle.digest("SHA-512", new TextEncoder().encode(s)));
const parse = s => { try { return JSON.parse(s); } catch (e) { return {}; } };

async function hashPassword(password, saltHex, iterations = 100000) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const normEmail = e => String(e || "").trim().toLowerCase();
const normPhone = p => { let d = String(p || "").replace(/\D/g, ""); if (d.startsWith("62")) d = "0" + d.slice(2); return d; };
const str = (v, max = 120) => String(v ?? "").trim().slice(0, max);
const num = (v, min = 0, max = 1e12) => Math.min(Math.max(+v || 0, min), max);
const okId = v => /^[A-Za-z0-9_-]{2,48}$/.test(String(v || "")) ? String(v) : fail(400, "ID tidak valid");
function checkPassword(p) { if (typeof p !== "string" || p.length < 8) fail(400, "Kata sandi minimal 8 karakter"); }
function checkEmail(e) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(400, "Email tidak valid"); }

function access(t, now = Date.now()) {
  if (t.status !== "aktif") return "suspended";
  if (t.paid_until > now) return "paid";
  if (t.trial_ends > now) return "trial";
  return "expired";
}
function tenantOut(t) {
  const now = Date.now(); const a = access(t, now);
  const until = a === "paid" ? t.paid_until : a === "trial" ? t.trial_ends : null;
  return {
    id: t.id, name: t.name, type: t.type, city: t.city, tax: t.tax, plan: planKey(t.plan), status: t.status,
    joined: t.created, trialEnds: t.trial_ends, paidUntil: t.paid_until, access: a,
    daysLeft: until ? Math.max(0, Math.ceil((until - now) / DAY)) : 0,
    payRequest: t.pay_request ? (r => ({ ...r, plan: planKey(r.plan) }))(parse(t.pay_request)) : null
  };
}
const userOut = (u, meta) => ({ id: u.id, name: u.name, email: u.email, role: u.role, tenantId: u.tenant_id, outletId: meta && meta.outletId || null, hasPin: !!(meta && meta.pinHash) });

function cookie(token, maxAge) {
  return `ks=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
async function startSession(env, userId) {
  const token = randHex(32);
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, Date.now() + SESSION_DAYS * DAY).run();
  return cookie(token, SESSION_DAYS * 86400);
}

async function loadSession(request, env) {
  // The Android app runs from its own local origin, so it sends the token as a bearer header instead of a cookie.
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)ks=([0-9a-f]{64})/) || (request.headers.get("authorization") || "").match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return null;
  const hash = await sha256(m[1]);
  const s = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash = ?").bind(hash).first();
  if (!s || s.expires < Date.now()) return null;
  const real = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(s.user_id).first();
  if (!real) return null;
  let user = real;
  if (s.acting_as && real.role === "superadmin") user = (await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(s.acting_as).first()) || real;
  const tenant = user.tenant_id ? await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(user.tenant_id).first() : null;
  return { hash, real, user, tenant, impersonating: user.id !== real.id };
}

function requireTenant(sess, { roles, allowInactive } = {}) {
  if (!sess) fail(401, "Silakan masuk dulu");
  if (!sess.tenant) fail(403, "Akun ini tidak terhubung ke usaha");
  if (roles && !roles.includes(sess.user.role)) fail(403, "Peranmu tidak punya akses untuk ini");
  if (!allowInactive) {
    const a = access(sess.tenant);
    if (a === "suspended") fail(403, "Akun usaha sedang ditangguhkan");
    if (a === "expired") fail(402, "Masa coba atau langganan sudah habis. Silakan bayar langganan.");
  }
  return sess.tenant;
}
function requireSuper(sess) {
  if (!sess || sess.real.role !== "superadmin") fail(403, "Khusus Pemilik Aplikasi");
}
const isManager = sess => MANAGERS.includes(sess.user.role);

/* ---------- settings, meta, outlets ---------- */
const DEFAULT_SETTINGS = {
  address: "", phone: "", receiptFooter: "Terima kasih, sampai jumpa lagi!", service: 0, requireShift: true,
  tables: [], loyalty: { enabled: false, earnPer: 10000, pointValue: 100 },
  midtrans: { serverKey: "", clientKey: "", production: false }
};
async function getSettings(env, tid) {
  const r = await env.DB.prepare("SELECT data FROM settings WHERE tenant_id = ?").bind(tid).first();
  const s = r ? parse(r.data) : {};
  return { ...DEFAULT_SETTINGS, ...s, loyalty: { ...DEFAULT_SETTINGS.loyalty, ...(s.loyalty || {}) }, midtrans: { ...DEFAULT_SETTINGS.midtrans, ...(s.midtrans || {}) } };
}
function settingsOut(s) {
  const { midtrans, ...rest } = s;
  return { ...rest, midtrans: { configured: !!midtrans.serverKey, production: !!midtrans.production, clientKey: midtrans.clientKey || "" } };
}
async function saveSettings(env, tid, s) {
  await env.DB.prepare("INSERT INTO settings (tenant_id, data) VALUES (?, ?) ON CONFLICT (tenant_id) DO UPDATE SET data = excluded.data").bind(tid, JSON.stringify(s)).run();
}
async function getMeta(env, uid) {
  const r = await env.DB.prepare("SELECT data FROM user_meta WHERE user_id = ?").bind(uid).first();
  return r ? parse(r.data) : {};
}
async function saveMeta(env, uid, tid, meta) {
  await env.DB.prepare("INSERT INTO user_meta (user_id, tenant_id, data) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data").bind(uid, tid, JSON.stringify(meta)).run();
}

// Older tenants kept stock inside product JSON; move it into the per-outlet stock table once.
async function ensureMain(env, t) {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO outlets (tenant_id, id, data) VALUES (?, ?, ?)").bind(t.id, MAIN, JSON.stringify({ id: MAIN, name: "Outlet utama", address: "", created: t.created })),
    env.DB.prepare("INSERT OR IGNORE INTO stock (tenant_id, outlet_id, product_id, qty) SELECT tenant_id, ?, id, COALESCE(json_extract(data, '$.stock'), 0) FROM products WHERE tenant_id = ? AND json_extract(data, '$.stock') IS NOT NULL AND json_extract(data, '$.stockMigrated') IS NULL").bind(MAIN, t.id),
    env.DB.prepare("UPDATE products SET data = json_set(data, '$.stockMigrated', 1) WHERE tenant_id = ? AND json_extract(data, '$.stockMigrated') IS NULL").bind(t.id)
  ]);
}
async function listOutlets(env, tid) {
  return (await env.DB.prepare("SELECT data FROM outlets WHERE tenant_id = ?").bind(tid).all()).results.map(r => parse(r.data)).filter(o => !o.deleted);
}
async function resolveOutlet(env, sess, requested) {
  const meta = await getMeta(env, sess.user.id);
  const forced = sess.user.role === "cashier" && meta.outletId;
  const id = forced ? meta.outletId : (requested && requested !== "all" ? String(requested) : MAIN);
  if (id !== MAIN) {
    const o = await env.DB.prepare("SELECT data FROM outlets WHERE tenant_id = ? AND id = ?").bind(sess.tenant.id, id).first();
    if (!o || parse(o.data).deleted) fail(404, "Outlet tidak ditemukan");
  }
  return id;
}

/* ---------- PIN approval ---------- */
async function verifyPin(env, sess, pin) {
  pin = String(pin || "");
  if (!/^\d{4,8}$/.test(pin)) fail(400, "Masukkan PIN manajer");
  const myMeta = await getMeta(env, sess.user.id);
  if (myMeta.pinLock && myMeta.pinLock > Date.now()) fail(429, "Terlalu banyak PIN salah. Coba lagi beberapa menit lagi.");
  const mgrs = (await env.DB.prepare("SELECT u.id, u.name, m.data FROM users u JOIN user_meta m ON m.user_id = u.id WHERE u.tenant_id = ? AND u.role IN ('owner','manager')").bind(sess.tenant.id).all()).results;
  for (const m of mgrs) {
    const d = parse(m.data);
    if (d.pinHash && safeEqual(await hashPassword(pin, d.pinSalt, 20000), d.pinHash)) {
      if (myMeta.pinFails) { myMeta.pinFails = 0; await saveMeta(env, sess.user.id, sess.tenant.id, myMeta); }
      return { id: m.id, name: m.name };
    }
  }
  myMeta.pinFails = (myMeta.pinFails || 0) + 1;
  if (myMeta.pinFails >= 5) { myMeta.pinFails = 0; myMeta.pinLock = Date.now() + 5 * 60000; }
  await saveMeta(env, sess.user.id, sess.tenant.id, myMeta);
  fail(403, mgrs.some(m => parse(m.data).pinHash) ? "PIN salah" : "Belum ada PIN manajer. Pemilik atau manajer perlu membuat PIN di menu Akun Saya.");
}

/* ---------- products & stock ---------- */
async function loadProducts(env, tid) {
  const rows = (await env.DB.prepare("SELECT data FROM products WHERE tenant_id = ?").bind(tid).all()).results;
  const map = new Map();
  for (const r of rows) { const p = parse(r.data); if (p.track === undefined) p.track = !(+p.stock >= 999); delete p.stock; map.set(p.id, p); }
  return map;
}
async function stockMap(env, tid, outlet) {
  const rows = (await env.DB.prepare("SELECT product_id, qty FROM stock WHERE tenant_id = ? AND outlet_id = ?").bind(tid, outlet).all()).results;
  return Object.fromEntries(rows.map(r => [r.product_id, r.qty]));
}
const stockStmt = (env, tid, outlet, pid, delta) =>
  env.DB.prepare("INSERT INTO stock (tenant_id, outlet_id, product_id, qty) VALUES (?, ?, ?, ?) ON CONFLICT (tenant_id, outlet_id, product_id) DO UPDATE SET qty = qty + excluded.qty").bind(tid, outlet, pid, delta);
const moveStmt = (env, tid, m) =>
  env.DB.prepare("INSERT INTO moves (tenant_id, id, time, outlet_id, product_id, qty, kind, ref, user_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(tid, newId("m"), m.time || Date.now(), m.outlet, m.pid, m.qty, m.kind, m.ref || null, m.user || null, m.note || null);
// Sum stock effects for priced lines and return statements that apply `sign` (-1 sale, +1 refund).
function saleStockStmts(env, tid, outlet, products, lines, sign, kind, ref, user, time) {
  const agg = {};
  for (const l of lines) {
    const p = products.get(l.pid); if (!p) continue;
    for (const e of stockEffects(p, l.factor || 1, l.qty, id => products.get(id))) agg[e.pid] = (agg[e.pid] || 0) + e.qty;
  }
  const out = [];
  for (const [pid, q] of Object.entries(agg)) {
    if (!q) continue;
    out.push(stockStmt(env, tid, outlet, pid, sign * q));
    out.push(moveStmt(env, tid, { time, outlet, pid, qty: sign * q, kind, ref, user }));
  }
  return out;
}
function cleanProduct(p, id, tid) {
  const units = Array.isArray(p.units) ? p.units.map(u => ({ name: str(u.name, 20), qty: Math.max(2, Math.floor(+u.qty || 0)), price: num(u.price), sku: str(u.sku, 40) || undefined })).filter(u => u.name && u.qty > 1).slice(0, 5) : undefined;
  const mods = Array.isArray(p.mods) ? p.mods.map(m => ({ name: str(m.name, 30), opts: (Array.isArray(m.opts) ? m.opts : []).map(o => str(o, 30)).filter(Boolean).slice(0, 10) })).filter(m => m.name && m.opts.length).slice(0, 6) : undefined;
  const recipe = Array.isArray(p.recipe) ? p.recipe.map(r => ({ pid: str(r.pid, 48), qty: num(r.qty, 0, 1e6) })).filter(r => r.pid && r.qty > 0).slice(0, 30) : undefined;
  return {
    id, tenantId: tid, name: str(p.name), cat: str(p.cat, 60) || "Umum", price: num(p.price), cost: num(p.cost),
    unit: str(p.unit, 20) || "pcs", units: units && units.length ? units : undefined,
    sku: str(p.sku, 40) || undefined, exp: +p.exp || undefined,
    whole: p.whole && +p.whole.min > 1 && +p.whole.price > 0 ? { min: Math.floor(+p.whole.min), price: num(p.whole.price) } : undefined,
    mods: mods && mods.length ? mods : undefined, recipe: recipe && recipe.length ? recipe : undefined,
    track: recipe && recipe.length ? false : p.track !== false, ingredient: !!p.ingredient, minStock: num(p.minStock, 0, 1e6) || undefined,
    stockMigrated: 1
  };
}

/* ---------- routes ---------- */
const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn });

function starterProducts(type) {
  if (type === "F&B") return [
    { name: "Es Teh Manis", cat: "Minuman", price: 5000, cost: 1500, stock: 100 },
    { name: "Kopi Susu", cat: "Minuman", price: 15000, cost: 6000, stock: 100, mods: [{ name: "Gula", opts: ["Normal", "Less", "Tanpa"] }, { name: "Es", opts: ["Normal", "Sedikit"] }] },
    { name: "Nasi Goreng", cat: "Makanan", price: 20000, cost: 9000, stock: 50, mods: [{ name: "Pedas", opts: ["Tidak", "Sedang", "Pedas"] }] },
    { name: "Mi Goreng", cat: "Makanan", price: 18000, cost: 8000, stock: 50 }
  ];
  if (type === "Jasa") return [
    { name: "Layanan Standar", cat: "Layanan", price: 25000, cost: 8000, track: false },
    { name: "Layanan Premium", cat: "Layanan", price: 50000, cost: 15000, track: false }
  ];
  return [
    { name: "Air Mineral 600 ml", cat: "Minuman", price: 4000, cost: 2500, stock: 48, units: [{ name: "dus", qty: 24, price: 84000 }] },
    { name: "Mi Instan Goreng", cat: "Makanan", price: 3500, cost: 2800, stock: 40, whole: { min: 10, price: 3200 } },
    { name: "Gula Pasir 1 kg", cat: "Sembako", price: 17500, cost: 15000, stock: 20 }
  ];
}

on("POST", "signup", async ({ env, body }) => {
  const email = normEmail(body.email); checkEmail(email); checkPassword(body.password);
  const name = str(body.name), business = str(body.business), city = str(body.city, 60);
  const type = TYPES.includes(body.type) ? body.type : "F&B";
  if (!name || !business || !city) fail(400, "Lengkapi nama, nama usaha, dan kota");
  if (env.OWNER_EMAIL && email === normEmail(env.OWNER_EMAIL)) fail(400, "Email ini khusus Pemilik Aplikasi. Pakai halaman aktivasi pemilik.");
  if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) fail(409, "Email sudah terdaftar. Silakan masuk.");
  const now = Date.now(), tid = newId("t"), uid = newId("u"), salt = randHex(16);
  const stmts = [
    env.DB.prepare("INSERT INTO tenants (id, name, type, city, tax, plan, status, trial_ends, paid_until, created) VALUES (?, ?, ?, ?, ?, 'bulanan', 'aktif', ?, 0, ?)")
      .bind(tid, business, type, city, type === "F&B" ? 10 : 0, now + TRIAL_DAYS * DAY, now),
    env.DB.prepare("INSERT INTO users (id, email, name, role, tenant_id, pass_hash, pass_salt, created) VALUES (?, ?, ?, 'owner', ?, ?, ?, ?)")
      .bind(uid, email, name, tid, await hashPassword(body.password, salt), salt, now),
    env.DB.prepare("INSERT INTO outlets (tenant_id, id, data) VALUES (?, ?, ?)").bind(tid, MAIN, JSON.stringify({ id: MAIN, name: "Outlet utama", address: city, created: now })),
    env.DB.prepare("INSERT INTO settings (tenant_id, data) VALUES (?, ?)").bind(tid, JSON.stringify({ tables: type === "F&B" ? Array.from({ length: 10 }, (_, i) => ({ id: "m" + (i + 1), name: String(i + 1), area: "Dalam" })) : [] }))
  ];
  for (const sp of starterProducts(type)) {
    const id = newId("p"), p = cleanProduct(sp, id, tid);
    stmts.push(env.DB.prepare("INSERT INTO products (tenant_id, id, data) VALUES (?, ?, ?)").bind(tid, id, JSON.stringify(p)));
    if (p.track && sp.stock) stmts.push(stockStmt(env, tid, MAIN, id, sp.stock));
  }
  await env.DB.batch(stmts);
  return json({ ok: true }, 200, { "set-cookie": await startSession(env, uid) });
});

on("POST", "setup-owner", async ({ env, body }) => {
  const email = normEmail(body.email); checkEmail(email); checkPassword(body.password);
  if (!env.OWNER_EMAIL || email !== normEmail(env.OWNER_EMAIL)) fail(403, "Email ini bukan email Pemilik Aplikasi");
  if (await env.DB.prepare("SELECT 1 FROM users WHERE role = 'superadmin'").first()) fail(409, "Akun Pemilik Aplikasi sudah aktif. Silakan masuk.");
  if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) fail(409, "Email sudah terdaftar");
  const uid = newId("u"), salt = randHex(16);
  await env.DB.prepare("INSERT INTO users (id, email, name, role, tenant_id, pass_hash, pass_salt, created) VALUES (?, ?, ?, 'superadmin', NULL, ?, ?, ?)")
    .bind(uid, email, str(body.name) || "Pemilik Aplikasi", await hashPassword(body.password, salt), salt, Date.now()).run();
  return json({ ok: true }, 200, { "set-cookie": await startSession(env, uid) });
});

on("POST", "login", async ({ env, body }) => {
  const email = normEmail(body.email);
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  const ok = u && safeEqual(await hashPassword(String(body.password || ""), u.pass_salt), u.pass_hash);
  if (!ok) fail(401, "Email atau kata sandi salah");
  await env.DB.prepare("DELETE FROM sessions WHERE expires < ?").bind(Date.now()).run();
  return json({ ok: true }, 200, { "set-cookie": await startSession(env, u.id) });
});

on("POST", "logout", async ({ env, sess }) => {
  if (sess) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(sess.hash).run();
  return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
});

/* ---------- password & PIN ---------- */
async function setPassword(env, uid, password) {
  const salt = randHex(16);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?").bind(await hashPassword(password, salt), salt, uid),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(uid),
    env.DB.prepare("DELETE FROM resets WHERE user_id = ?").bind(uid)
  ]);
}
async function makeResetLink(env, request, uid, hours) {
  const token = randHex(32);
  await env.DB.prepare("INSERT INTO resets (token_hash, user_id, expires) VALUES (?, ?, ?)").bind(await sha256(token), uid, Date.now() + hours * 3600000).run();
  return new URL(request.url).origin + "/app/#reset=" + token;
}

on("POST", "password/change", async ({ env, sess, body }) => {
  if (!sess) fail(401, "Silakan masuk dulu");
  const u = sess.real;
  if (!safeEqual(await hashPassword(String(body.old || ""), u.pass_salt), u.pass_hash)) fail(403, "Kata sandi lama salah");
  checkPassword(body.password);
  await setPassword(env, u.id, body.password);
  return json({ ok: true }, 200, { "set-cookie": await startSession(env, u.id) });
});

on("POST", "password/forgot", async ({ env, request, body }) => {
  const email = normEmail(body.email); checkEmail(email);
  const mail = !!(env.RESEND_API_KEY && env.MAIL_FROM);
  const u = await env.DB.prepare("SELECT id, name, role FROM users WHERE email = ?").bind(email).first();
  if (u && mail) {
    const link = await makeResetLink(env, request, u.id, 2);
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: email, subject: "Atur ulang kata sandi Kasvara",
        html: `<p>Halo ${u.name.replace(/[<>&]/g, "")},</p><p>Klik tautan ini untuk membuat kata sandi baru (berlaku 2 jam):</p><p><a href="${link}">${link}</a></p><p>Abaikan email ini kalau kamu tidak memintanya.</p>` })
    }).catch(() => {});
  }
  return json({ ok: true, mail });
});

on("POST", "password/reset", async ({ env, body }) => {
  checkPassword(body.password);
  const t = String(body.token || "");
  if (!/^[0-9a-f]{64}$/.test(t)) fail(400, "Tautan tidak valid");
  const r = await env.DB.prepare("SELECT * FROM resets WHERE token_hash = ?").bind(await sha256(t)).first();
  if (!r || r.expires < Date.now()) fail(410, "Tautan sudah kedaluwarsa. Minta tautan baru.");
  await setPassword(env, r.user_id, body.password);
  return json({ ok: true }, 200, { "set-cookie": await startSession(env, r.user_id) });
});

on("POST", "pin", async ({ env, sess, body }) => {
  const t = requireTenant(sess, { roles: MANAGERS, allowInactive: true });
  if (!safeEqual(await hashPassword(String(body.password || ""), sess.real.pass_salt), sess.real.pass_hash)) fail(403, "Kata sandi salah");
  const pin = String(body.pin || "");
  if (!/^\d{6}$/.test(pin)) fail(400, "PIN harus 6 angka");
  const meta = await getMeta(env, sess.user.id), salt = randHex(16);
  meta.pinSalt = salt; meta.pinHash = await hashPassword(pin, salt, 20000);
  await saveMeta(env, sess.user.id, t.id, meta);
  return json({ ok: true });
});

/* ---------- session & bulk data ---------- */
on("GET", "plans", async ({ env }) => json({ plans: await getPlans(env) }));

on("PUT", "admin/plans", async ({ env, sess, body }) => {
  requireSuper(sess);
  const cur = await getPlans(env), next = {};
  for (const k of Object.keys(PLANS)) {
    const v = body.plans && body.plans[k] ? Math.round(+body.plans[k].price) : cur[k].price;
    if (!(v >= 1000 && v <= 100000000)) fail(400, "Harga paket " + PLANS[k].name + " tidak valid");
    next[k] = { price: v };
  }
  await env.DB.prepare("INSERT INTO platform (key, data) VALUES ('plans', ?) ON CONFLICT (key) DO UPDATE SET data = excluded.data").bind(JSON.stringify(next)).run();
  return json({ plans: await getPlans(env) });
});

on("GET", "me", async ({ env, sess }) => {
  if (!sess) fail(401, "Belum masuk");
  const meta = await getMeta(env, sess.user.id);
  const out = { user: userOut(sess.user, meta), impersonating: sess.impersonating, tenant: null, staff: [], outlets: [], settings: null, plans: await getPlans(env) };
  if (sess.tenant) {
    await ensureMain(env, sess.tenant);
    out.tenant = tenantOut(sess.tenant);
    const [users, metas] = await Promise.all([
      env.DB.prepare("SELECT * FROM users WHERE tenant_id = ? ORDER BY created").bind(sess.tenant.id).all(),
      env.DB.prepare("SELECT user_id, data FROM user_meta WHERE tenant_id = ?").bind(sess.tenant.id).all()
    ]);
    const mm = Object.fromEntries(metas.results.map(r => [r.user_id, parse(r.data)]));
    out.staff = users.results.map(u => userOut(u, mm[u.id]));
    out.outlets = await listOutlets(env, sess.tenant.id);
    out.settings = settingsOut(await getSettings(env, sess.tenant.id));
  }
  return json(out);
});

on("GET", "data", async ({ env, sess, url }) => {
  const t = requireTenant(sess);
  await ensureMain(env, t);
  const outlet = await resolveOutlet(env, sess, url.searchParams.get("outlet"));
  const all = url.searchParams.get("outlet") === "all" && isManager(sess);
  const since = Date.now() - 30 * DAY;
  const mine = sess.user.role === "cashier";
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results);
  const [prods, stock, trx, bills, kitchen, customers, promos, suppliers, shift] = await Promise.all([
    loadProducts(env, t.id),
    stockMap(env, t.id, outlet),
    all ? q("SELECT data FROM transactions WHERE tenant_id = ? AND time > ? ORDER BY time DESC LIMIT 5000", t.id, since)
      : q("SELECT data FROM transactions WHERE tenant_id = ? AND time > ? AND COALESCE(json_extract(data, '$.outletId'), 'main') = ?" + (mine ? " AND cashier_id = ?" : "") + " ORDER BY time DESC LIMIT 5000", ...(mine ? [t.id, since, outlet, sess.user.id] : [t.id, since, outlet])),
    q("SELECT data FROM bills WHERE tenant_id = ? AND outlet_id = ? AND status = 'open' ORDER BY updated", t.id, outlet),
    q("SELECT id, status, data FROM kitchen WHERE tenant_id = ? AND outlet_id = ? AND status != 'selesai' AND time > ? ORDER BY time", t.id, outlet, Date.now() - DAY),
    q("SELECT data FROM customers WHERE tenant_id = ? LIMIT 5000", t.id),
    q("SELECT data FROM promos WHERE tenant_id = ?", t.id),
    isManager(sess) ? q("SELECT data FROM suppliers WHERE tenant_id = ?", t.id) : Promise.resolve([]),
    env.DB.prepare("SELECT * FROM shifts WHERE tenant_id = ? AND user_id = ? AND closed IS NULL ORDER BY opened DESC LIMIT 1").bind(t.id, sess.user.id).first()
  ]);
  return json({
    outlet, products: [...prods.values()], stock, transactions: trx.map(r => parse(r.data)), bills: bills.map(r => parse(r.data)),
    kitchen: kitchen.map(r => ({ ...parse(r.data), id: r.id, status: r.status })), customers: customers.map(r => parse(r.data)),
    promos: promos.map(r => parse(r.data)), suppliers: suppliers.map(r => parse(r.data)), shift: shift ? shiftOut(shift) : null
  });
});

/* ---------- products ---------- */
on("PUT", "products/:id", async ({ env, sess, body, params }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  const id = okId(params.id);
  const clean = cleanProduct(body.product || {}, id, t.id);
  if (!clean.name) fail(400, "Nama produk wajib diisi");
  if (clean.sku) {
    const dup = await env.DB.prepare("SELECT 1 FROM products WHERE tenant_id = ? AND id != ? AND (json_extract(data, '$.sku') = ? OR EXISTS (SELECT 1 FROM json_each(json_extract(data, '$.units')) WHERE json_extract(value, '$.sku') = ?))").bind(t.id, id, clean.sku, clean.sku).first();
    if (dup) fail(409, "Barcode sudah dipakai produk lain");
  }
  const stmts = [env.DB.prepare("INSERT INTO products (tenant_id, id, data) VALUES (?, ?, ?) ON CONFLICT (tenant_id, id) DO UPDATE SET data = excluded.data").bind(t.id, id, JSON.stringify(clean))];
  let stock = null;
  if (clean.track && body.stock !== undefined && body.stock !== null && body.stock !== "") {
    const outlet = await resolveOutlet(env, sess, body.outlet);
    const cur = await env.DB.prepare("SELECT qty FROM stock WHERE tenant_id = ? AND outlet_id = ? AND product_id = ?").bind(t.id, outlet, id).first();
    const target = num(body.stock, -1e9, 1e9), diff = target - (cur ? cur.qty : 0);
    if (diff) { stmts.push(stockStmt(env, t.id, outlet, id, diff), moveStmt(env, t.id, { outlet, pid: id, qty: diff, kind: cur ? "adjust" : "awal", user: sess.user.id, note: "Ubah stok dari form produk" })); }
    stock = target;
  }
  await env.DB.batch(stmts);
  return json({ product: clean, stock });
});

on("DELETE", "products/:id", async ({ env, sess, params }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM products WHERE tenant_id = ? AND id = ?").bind(t.id, params.id),
    env.DB.prepare("DELETE FROM stock WHERE tenant_id = ? AND product_id = ?").bind(t.id, params.id)
  ]);
  return json({ ok: true });
});

on("GET", "stock", async ({ env, sess, url }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  return json({ stock: await stockMap(env, t.id, await resolveOutlet(env, sess, url.searchParams.get("outlet"))) });
});

/* ---------- transactions ---------- */
async function pricingCtx(env, t, products, settings, customerId) {
  const promos = (await env.DB.prepare("SELECT data FROM promos WHERE tenant_id = ?").bind(t.id).all()).results.map(r => parse(r.data));
  const customer = customerId ? await env.DB.prepare("SELECT data FROM customers WHERE tenant_id = ? AND id = ?").bind(t.id, String(customerId)).first().then(r => r ? parse(r.data) : null) : null;
  return { products, tax: t.tax, service: settings.service, promos, loyalty: settings.loyalty, customer, now: Date.now() };
}
const kitchenStmt = (env, tid, outlet, data) => env.DB.prepare("INSERT INTO kitchen (tenant_id, id, outlet_id, time, status, data) VALUES (?, ?, ?, ?, 'baru', ?)")
  .bind(tid, data.id, outlet, data.time, JSON.stringify(data));

on("POST", "trx", async ({ env, sess, body }) => {
  const t = requireTenant(sess);
  const id = okId(body.id);
  const prev = await env.DB.prepare("SELECT data FROM transactions WHERE tenant_id = ? AND id = ?").bind(t.id, id).first();
  if (prev) return json({ trx: parse(prev.data), duplicate: true });
  const outlet = await resolveOutlet(env, sess, body.outlet);
  const settings = await getSettings(env, t.id);
  const shift = await env.DB.prepare("SELECT * FROM shifts WHERE tenant_id = ? AND user_id = ? AND closed IS NULL ORDER BY opened DESC LIMIT 1").bind(t.id, sess.user.id).first();
  if (settings.requireShift && !shift && !(body.shiftId && await env.DB.prepare("SELECT 1 FROM shifts WHERE tenant_id = ? AND id = ?").bind(t.id, String(body.shiftId)).first())) fail(409, "Buka shift kasir dulu sebelum berjualan");
  const products = await loadProducts(env, t.id);
  const ctx = await pricingCtx(env, t, products, settings, body.customerId);
  const pr = priceOrder({ lines: body.lines, discPct: body.discPct, voucherCode: body.voucherCode, redeemPoints: body.redeemPoints }, ctx);
  if (!pr.lines.length) fail(400, "Keranjang kosong atau produk tidak ditemukan");
  if (pr.voucherError) fail(400, pr.voucherError);
  const method = METHODS.includes(body.method) ? body.method : "Tunai";
  // Offline sales are priced on the device; accept the cash taken then if it covered the device total.
  const clientTotal = Math.round(+body.clientTotal || 0);
  let paid = method === "Tunai" ? Math.round(+body.paid || 0) : pr.total;
  if (method === "Tunai" && paid < pr.total && !(body.offline && clientTotal && paid >= clientTotal)) fail(400, "Uang yang diterima kurang dari total");
  let payment = null;
  if (body.paymentId) {
    const p = await env.DB.prepare("SELECT * FROM payments WHERE id = ? AND tenant_id = ?").bind(String(body.paymentId), t.id).first();
    if (!p || p.status !== "settlement") fail(402, "Pembayaran QRIS belum diterima");
    if (p.amount < pr.total) fail(400, "Nominal QRIS lebih kecil dari total");
    payment = { id: p.id, provider: "midtrans" };
  }
  const time = body.offline && +body.time > Date.now() - 7 * DAY && +body.time <= Date.now() ? +body.time : Date.now();
  const fnb = t.type === "F&B";
  const trx = {
    id, tenantId: t.id, outletId: outlet, cashierId: sess.user.id, cashierName: sess.user.name, shiftId: shift ? shift.id : body.shiftId || null, time,
    items: pr.lines, subtotal: pr.subtotal, promo: pr.promo, discPct: pr.discPct, manualDisc: pr.manual, voucher: pr.voucher,
    pointsRedeemed: pr.pointsRedeemed, pointsValue: pr.pointsValue, discount: pr.discount, service: pr.service, tax: pr.tax, total: pr.total,
    method, paid, change: Math.max(0, paid - pr.total), payment,
    orderType: fnb ? (["Makan di sini", "Bawa pulang", "Ojol"].includes(body.orderType) ? body.orderType : "Makan di sini") : undefined,
    table: fnb ? str(body.table, 20) || undefined : undefined, billId: body.billId || undefined,
    customer: ctx.customer ? { id: ctx.customer.id, name: ctx.customer.name, phone: ctx.customer.phone } : null,
    pointsEarned: pr.pointsEarned, refunds: [], refunded: 0, status: "ok", offline: !!body.offline,
    priceDiff: body.offline && clientTotal && clientTotal !== pr.total ? clientTotal - pr.total : undefined
  };
  const stmts = [env.DB.prepare("INSERT INTO transactions (tenant_id, id, time, cashier_id, total, data) VALUES (?, ?, ?, ?, ?, ?)").bind(t.id, id, time, sess.user.id, pr.total, JSON.stringify(trx))];
  stmts.push(...saleStockStmts(env, t.id, outlet, products, pr.lines, -1, "jual", id, sess.user.id, time));
  if (ctx.customer) {
    const c = ctx.customer;
    c.points = Math.max(0, (+c.points || 0) - pr.pointsRedeemed + pr.pointsEarned); c.spent = (+c.spent || 0) + pr.total; c.visits = (+c.visits || 0) + 1; c.last = time;
    stmts.push(env.DB.prepare("UPDATE customers SET data = ? WHERE tenant_id = ? AND id = ?").bind(JSON.stringify(c), t.id, c.id));
  }
  if (pr.voucher) stmts.push(env.DB.prepare("UPDATE promos SET data = json_set(data, '$.used', COALESCE(json_extract(data, '$.used'), 0) + 1) WHERE tenant_id = ? AND id = ?").bind(t.id, pr.voucher.id));
  if (body.billId) {
    const b = await env.DB.prepare("SELECT data FROM bills WHERE tenant_id = ? AND id = ? AND status = 'open'").bind(t.id, String(body.billId)).first();
    if (b) {
      const bill = parse(b.data);
      for (const l of pr.lines) {
        let need = l.qty;
        for (const bl of bill.lines) { if (need && lineKey(bl) === l.key) { const take = Math.min(bl.qty, need); bl.qty -= take; need -= take; } }
      }
      bill.lines = bill.lines.filter(bl => bl.qty > 0);
      bill.paid = [...(bill.paid || []), id];
      stmts.push(env.DB.prepare("UPDATE bills SET data = ?, status = ?, updated = ? WHERE tenant_id = ? AND id = ?").bind(JSON.stringify(bill), bill.lines.length ? "open" : "paid", Date.now(), t.id, bill.id));
      trx.table = trx.table || bill.table; trx.orderType = trx.orderType || bill.orderType;
      stmts[0] = env.DB.prepare("INSERT INTO transactions (tenant_id, id, time, cashier_id, total, data) VALUES (?, ?, ?, ?, ?, ?)").bind(t.id, id, time, sess.user.id, pr.total, JSON.stringify(trx));
    }
  } else if (fnb && body.kitchen !== false) {
    stmts.push(kitchenStmt(env, t.id, outlet, { id: "K" + id, ref: id, time, table: trx.table, orderType: trx.orderType, by: sess.user.name, lines: pr.lines.map(l => ({ name: l.name, qty: l.qty, mods: l.mods, note: l.note })) }));
  }
  await env.DB.batch(stmts);
  return json({ trx });
});

on("GET", "trx", async ({ env, sess, url }) => {
  const t = requireTenant(sess);
  const from = +url.searchParams.get("from") || Date.now() - 7 * DAY, to = +url.searchParams.get("to") || Date.now();
  if (to - from > 400 * DAY) fail(400, "Rentang maksimal 1 tahun");
  const outletQ = url.searchParams.get("outlet");
  const all = outletQ === "all" && isManager(sess);
  const outlet = all ? null : await resolveOutlet(env, sess, outletQ);
  let sql = "SELECT data FROM transactions WHERE tenant_id = ? AND time >= ? AND time <= ?", b = [t.id, from, to];
  if (!all) { sql += " AND COALESCE(json_extract(data, '$.outletId'), 'main') = ?"; b.push(outlet); }
  if (sess.user.role === "cashier") { sql += " AND cashier_id = ?"; b.push(sess.user.id); }
  const rows = (await env.DB.prepare(sql + " ORDER BY time DESC LIMIT 5000").bind(...b).all()).results;
  return json({ transactions: rows.map(r => parse(r.data)) });
});

// Refund some or all items of a transaction. Needs an owner/manager PIN; returns stock and adjusts points.
on("POST", "trx/:id/refund", async ({ env, sess, body, params }) => {
  const t = requireTenant(sess);
  const row = await env.DB.prepare("SELECT data FROM transactions WHERE tenant_id = ? AND id = ?").bind(t.id, params.id).first();
  if (!row) fail(404, "Transaksi tidak ditemukan");
  const x = parse(row.data);
  if (x.status === "void") fail(409, "Transaksi ini sudah dibatalkan seluruhnya");
  const approver = await verifyPin(env, sess, body.pin);
  const reason = str(body.reason, 200); if (!reason) fail(400, "Tulis alasan pembatalan");
  const refundedQty = {}; for (const r of x.refunds || []) for (const it of r.items) refundedQty[it.idx] = (refundedQty[it.idx] || 0) + it.qty;
  const want = body.all ? x.items.map((l, idx) => ({ idx, qty: l.qty - (refundedQty[idx] || 0) })) : (Array.isArray(body.items) ? body.items : []);
  const items = [];
  for (const w of want) {
    const l = x.items[+w.idx]; if (!l) continue;
    const q = Math.min(Math.floor(+w.qty || 0), l.qty - (refundedQty[+w.idx] || 0));
    if (q > 0) items.push({ idx: +w.idx, qty: q, name: l.name });
  }
  if (!items.length) fail(400, "Pilih item yang dikembalikan");
  const remainingAfter = x.items.reduce((s, l, idx) => s + l.qty - (refundedQty[idx] || 0), 0) - items.reduce((s, i) => s + i.qty, 0);
  const lineValue = items.reduce((s, i) => s + x.items[i.idx].amount / x.items[i.idx].qty * i.qty, 0);
  const amount = remainingAfter === 0 ? x.total - (x.refunded || 0) : Math.min(Math.round(lineValue * (x.subtotal ? x.total / x.subtotal : 1)), x.total - (x.refunded || 0));
  const shift = await env.DB.prepare("SELECT * FROM shifts WHERE tenant_id = ? AND user_id = ? AND closed IS NULL ORDER BY opened DESC LIMIT 1").bind(t.id, sess.user.id).first();
  const method = METHODS.includes(body.method) ? body.method : x.method;
  const ref = { id: newId("R"), time: Date.now(), items, amount, method, reason, by: sess.user.name, byId: sess.user.id, approvedBy: approver.name, shiftId: shift ? shift.id : null };
  x.refunds = [...(x.refunds || []), ref]; x.refunded = (x.refunded || 0) + amount;
  if (remainingAfter === 0) x.status = "void"; else x.status = "partial";
  const products = await loadProducts(env, t.id);
  const lines = items.map(i => ({ ...x.items[i.idx], qty: i.qty }));
  const stmts = [env.DB.prepare("UPDATE transactions SET data = ?, total = ? WHERE tenant_id = ? AND id = ?").bind(JSON.stringify(x), x.total - x.refunded, t.id, x.id)];
  stmts.push(...saleStockStmts(env, t.id, x.outletId || MAIN, products, lines, +1, "retur", x.id, sess.user.id));
  if (x.customer && x.customer.id) {
    const c = await env.DB.prepare("SELECT data FROM customers WHERE tenant_id = ? AND id = ?").bind(t.id, x.customer.id).first();
    if (c) {
      const cd = parse(c.data), ratio = x.total ? amount / x.total : 0;
      cd.points = Math.max(0, (+cd.points || 0) - Math.round((x.pointsEarned || 0) * ratio) + (x.status === "void" ? (x.pointsRedeemed || 0) : 0));
      cd.spent = Math.max(0, (+cd.spent || 0) - amount);
      stmts.push(env.DB.prepare("UPDATE customers SET data = ? WHERE tenant_id = ? AND id = ?").bind(JSON.stringify(cd), t.id, cd.id));
    }
  }
  if (shift && method === "Tunai") {
    const sd = parse(shift.data); sd.refunds = [...(sd.refunds || []), { trxId: x.id, amount, time: ref.time }];
    stmts.push(env.DB.prepare("UPDATE shifts SET data = ? WHERE tenant_id = ? AND id = ?").bind(JSON.stringify(sd), t.id, shift.id));
  }
  await env.DB.batch(stmts);
  return json({ trx: x });
});

/* ---------- shifts ---------- */
function shiftOut(s) { return { ...parse(s.data), id: s.id, outletId: s.outlet_id, userId: s.user_id, opened: s.opened, closed: s.closed }; }
async function shiftSummary(env, tid, s) {
  const d = parse(s.data);
  const trx = (await env.DB.prepare("SELECT data FROM transactions WHERE tenant_id = ? AND json_extract(data, '$.shiftId') = ?").bind(tid, s.id).all()).results.map(r => parse(r.data));
  const byMethod = {}; let sales = 0, count = 0;
  for (const x of trx) { byMethod[x.method] = (byMethod[x.method] || 0) + x.total; sales += x.total; count++; }
  const cashSales = byMethod.Tunai || 0;
  const cashRefunds = (d.refunds || []).reduce((a, r) => a + r.amount, 0);
  const cashIn = (d.cash || []).filter(c => c.type === "in").reduce((a, c) => a + c.amount, 0);
  const cashOut = (d.cash || []).filter(c => c.type === "out").reduce((a, c) => a + c.amount, 0);
  const expected = (d.openCash || 0) + cashSales - cashRefunds + cashIn - cashOut;
  return { sales, count, byMethod, cashSales, cashRefunds, cashIn, cashOut, expected };
}

on("GET", "shift", async ({ env, sess }) => {
  const t = requireTenant(sess);
  const s = await env.DB.prepare("SELECT * FROM shifts WHERE tenant_id = ? AND user_id = ? AND closed IS NULL ORDER BY opened DESC LIMIT 1").bind(t.id, sess.user.id).first();
  return json({ shift: s ? { ...shiftOut(s), summary: await shiftSummary(env, t.id, s) } : null });
});

on("POST", "shift/open", async ({ env, sess, body }) => {
  const t = requireTenant(sess);
  const cur = await env.DB.prepare("SELECT * FROM shifts WHERE tenant_id = ? AND user_id = ? AND closed IS NULL").bind(t.id, sess.user.id).first();
  if (cur) return json({ shift: shiftOut(cur) });
  const outlet = await resolveOutlet(env, sess, body.outlet);
  const id = newId("S"), now = Date.now();
  const data = { openCash: Math.round(num(body.openCash)), cash: [], refunds: [], userName: sess.user.name };
  await env.DB.prepare("INSERT INTO shifts (tenant_id, id, outlet_id, user_id, opened, closed, data) VALUES (?, ?, ?, ?, ?, NULL, ?)").bind(t.id, id, outlet, sess.user.id, now, JSON.stringify(data)).run();
  return json({ shift: { ...data, id, outletId: outlet, userId: sess.user.id, opened: now, closed: null } });
});

on("POST", "shift/cash", async ({ env, sess, body }) => {
  const t = requireTenant(sess);
  const s = await env.DB.prepare("SELECT * FROM shifts WHERE tenant_id = ? AND user_id = ? AND closed IS NULL").bind(t.id, sess.user.id).first();
  if (!s) fail(409, "Tidak ada shift yang terbuka");
  const amount = Math.round(num(body.amount)); if (!amount) fail(400, "Isi jumlah uang");
  const d = parse(s.data); d.cash = [...(d.cash || []), { type: body.type === "out" ? "out" : "in", amount, note: str(body.note, 120), time: Date.now() }];
  await env.DB.prepare("UPDATE shifts SET data = ? WHERE tenant_id = ? AND id = ?").bind(JSON.stringify(d), t.id, s.id).run();
  return json({ shift: { ...shiftOut({ ...s, data: JSON.stringify(d) }), summary: await shiftSummary(env, t.id, s) } });
});

on("POST", "shift/close", async ({ env, sess, body }) => {
  const t = requireTenant(sess, { allowInactive: true });
  const s = await env.DB.prepare("SELECT * FROM shifts WHERE tenant_id = ? AND user_id = ? AND closed IS NULL").bind(t.id, sess.user.id).first();
  if (!s) fail(409, "Tidak ada shift yang terbuka");
  const sum = await shiftSummary(env, t.id, s);
  const d = parse(s.data);
  d.counted = Math.round(num(body.counted)); d.expected = sum.expected; d.diff = d.counted - sum.expected; d.note = str(body.note, 200); d.summary = sum;
  const now = Date.now();
  await env.DB.prepare("UPDATE shifts SET data = ?, closed = ? WHERE tenant_id = ? AND id = ?").bind(JSON.stringify(d), now, t.id, s.id).run();
  return json({ shift: { ...shiftOut({ ...s, data: JSON.stringify(d), closed: now }) } });
});

on("GET", "shifts", async ({ env, sess, url }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  const from = +url.searchParams.get("from") || Date.now() - 7 * DAY, to = +url.searchParams.get("to") || Date.now();
  const rows = (await env.DB.prepare("SELECT * FROM shifts WHERE tenant_id = ? AND opened >= ? AND opened <= ? ORDER BY opened DESC LIMIT 500").bind(t.id, from, to).all()).results;
  const out = [];
  for (const s of rows) out.push({ ...shiftOut(s), summary: s.closed ? parse(s.data).summary : await shiftSummary(env, t.id, s) });
  return json({ shifts: out });
});

/* ---------- open bills, tables, kitchen ---------- */
on("POST", "bills", async ({ env, sess, body }) => {
  const t = requireTenant(sess);
  const outlet = await resolveOutlet(env, sess, body.outlet);
  const products = await loadProducts(env, t.id);
  const add = (Array.isArray(body.lines) ? body.lines : []).map(l => {
    const p = products.get(String(l.pid)); if (!p) return null;
    const q = Math.floor(+l.qty || 0); if (q <= 0) return null;
    return { pid: p.id, name: p.name, qty: q, unit: l.unit || "", mods: l.mods || null, note: l.note ? str(l.note, 120) : undefined };
  }).filter(Boolean);
  let bill;
  if (body.id) {
    const r = await env.DB.prepare("SELECT data FROM bills WHERE tenant_id = ? AND id = ? AND status = 'open'").bind(t.id, String(body.id)).first();
    if (!r) fail(404, "Pesanan terbuka tidak ditemukan");
    bill = parse(r.data);
  } else {
    if (!add.length) fail(400, "Tambahkan menu dulu");
    bill = { id: newId("B"), outletId: outlet, created: Date.now(), by: sess.user.name, lines: [] };
  }
  if (body.table !== undefined) bill.table = str(body.table, 20) || undefined;
  if (body.orderType) bill.orderType = ["Makan di sini", "Bawa pulang", "Ojol"].includes(body.orderType) ? body.orderType : "Makan di sini";
  if (body.label !== undefined) bill.label = str(body.label, 40) || undefined;
  if (body.customerId !== undefined) bill.customerId = body.customerId || undefined;
  if (bill.table) {
    const clash = (await env.DB.prepare("SELECT data FROM bills WHERE tenant_id = ? AND outlet_id = ? AND status = 'open' AND id != ?").bind(t.id, outlet, bill.id).all()).results.map(r => parse(r.data)).find(b => b.table === bill.table);
    if (clash) fail(409, "Meja " + bill.table + " sudah punya pesanan terbuka");
  }
  for (const a of add) {
    const ex = bill.lines.find(l => lineKey(l) === lineKey(a) && (l.note || "") === (a.note || ""));
    if (ex) ex.qty += a.qty; else bill.lines.push(a);
  }
  bill.updated = Date.now();
  const stmts = [env.DB.prepare("INSERT INTO bills (tenant_id, id, outlet_id, status, updated, data) VALUES (?, ?, ?, 'open', ?, ?) ON CONFLICT (tenant_id, id) DO UPDATE SET data = excluded.data, updated = excluded.updated").bind(t.id, bill.id, bill.outletId || outlet, bill.updated, JSON.stringify(bill))];
  if (add.length && t.type === "F&B") stmts.push(kitchenStmt(env, t.id, bill.outletId || outlet, { id: newId("K"), ref: bill.id, time: Date.now(), table: bill.table, label: bill.label, orderType: bill.orderType, by: sess.user.name, lines: add.map(l => ({ name: l.name, qty: l.qty, mods: l.mods, note: l.note })) }));
  await env.DB.batch(stmts);
  return json({ bill });
});

// Reduce or remove items already on a bill (needs a manager PIN once food was sent to the kitchen).
on("POST", "bills/:id/remove", async ({ env, sess, body, params }) => {
  const t = requireTenant(sess);
  const r = await env.DB.prepare("SELECT data FROM bills WHERE tenant_id = ? AND id = ? AND status = 'open'").bind(t.id, params.id).first();
  if (!r) fail(404, "Pesanan terbuka tidak ditemukan");
  const approver = await verifyPin(env, sess, body.pin);
  const bill = parse(r.data);
  const l = bill.lines[+body.idx]; if (!l) fail(400, "Item tidak ditemukan");
  l.qty -= Math.min(l.qty, Math.max(1, Math.floor(+body.qty || 1)));
  bill.lines = bill.lines.filter(x => x.qty > 0);
  bill.log = [...(bill.log || []), { time: Date.now(), by: sess.user.name, approvedBy: approver.name, removed: l.name, reason: str(body.reason, 120) }];
  bill.updated = Date.now();
  await env.DB.prepare("UPDATE bills SET data = ?, updated = ?, status = ? WHERE tenant_id = ? AND id = ?").bind(JSON.stringify(bill), bill.updated, bill.lines.length ? "open" : "cancelled", t.id, bill.id).run();
  return json({ bill, status: bill.lines.length ? "open" : "cancelled" });
});

on("POST", "bills/:id/cancel", async ({ env, sess, body, params }) => {
  const t = requireTenant(sess);
  const r = await env.DB.prepare("SELECT data FROM bills WHERE tenant_id = ? AND id = ? AND status = 'open'").bind(t.id, params.id).first();
  if (!r) fail(404, "Pesanan terbuka tidak ditemukan");
  const approver = await verifyPin(env, sess, body.pin);
  const bill = parse(r.data); bill.cancelled = { time: Date.now(), by: sess.user.name, approvedBy: approver.name, reason: str(body.reason, 120) };
  await env.DB.prepare("UPDATE bills SET data = ?, status = 'cancelled', updated = ? WHERE tenant_id = ? AND id = ?").bind(JSON.stringify(bill), Date.now(), t.id, bill.id).run();
  return json({ ok: true });
});

on("GET", "bills", async ({ env, sess, url }) => {
  const t = requireTenant(sess);
  const outlet = await resolveOutlet(env, sess, url.searchParams.get("outlet"));
  const rows = (await env.DB.prepare("SELECT data FROM bills WHERE tenant_id = ? AND outlet_id = ? AND status = 'open' ORDER BY updated").bind(t.id, outlet).all()).results;
  return json({ bills: rows.map(r => parse(r.data)) });
});

on("GET", "kitchen", async ({ env, sess, url }) => {
  const t = requireTenant(sess);
  const outlet = await resolveOutlet(env, sess, url.searchParams.get("outlet"));
  const rows = (await env.DB.prepare("SELECT id, status, data FROM kitchen WHERE tenant_id = ? AND outlet_id = ? AND status != 'selesai' AND time > ? ORDER BY time").bind(t.id, outlet, Date.now() - DAY).all()).results;
  return json({ kitchen: rows.map(r => ({ ...parse(r.data), id: r.id, status: r.status })) });
});

on("PATCH", "kitchen/:id", async ({ env, sess, body, params }) => {
  const t = requireTenant(sess);
  const k = ["baru", "proses", "siap", "selesai"].includes(body.status) ? body.status : fail(400, "Status dapur tidak valid");
  await env.DB.prepare("UPDATE kitchen SET status = ? WHERE tenant_id = ? AND id = ?").bind(k, t.id, params.id).run();
  return json({ ok: true });
});

/* ---------- customers, promos, suppliers ---------- */
on("PUT", "customers/:id", async ({ env, sess, body, params }) => {
  const t = requireTenant(sess);
  const id = okId(params.id);
  const phone = normPhone(body.phone); if (phone.length < 9) fail(400, "Nomor HP tidak valid");
  const name = str(body.name, 80); if (!name) fail(400, "Nama pelanggan wajib diisi");
  const dup = await env.DB.prepare("SELECT id FROM customers WHERE tenant_id = ? AND phone = ? AND id != ?").bind(t.id, phone, id).first();
  if (dup) fail(409, "Nomor HP sudah terdaftar sebagai member");
  const old = await env.DB.prepare("SELECT data FROM customers WHERE tenant_id = ? AND id = ?").bind(t.id, id).first();
  const prev = old ? parse(old.data) : { points: 0, spent: 0, visits: 0, joined: Date.now() };
  const c = { ...prev, id, name, phone, email: str(body.email, 80) || undefined, note: str(body.note, 200) || undefined };
  if (isManager(sess) && body.points !== undefined && body.points !== "") c.points = Math.floor(num(body.points, 0, 1e9));
  await env.DB.prepare("INSERT INTO customers (tenant_id, id, phone, data) VALUES (?, ?, ?, ?) ON CONFLICT (tenant_id, id) DO UPDATE SET phone = excluded.phone, data = excluded.data").bind(t.id, id, phone, JSON.stringify(c)).run();
  return json({ customer: c });
});
on("DELETE", "customers/:id", async ({ env, sess, params }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  await env.DB.prepare("DELETE FROM customers WHERE tenant_id = ? AND id = ?").bind(t.id, params.id).run();
  return json({ ok: true });
});

on("PUT", "promos/:id", async ({ env, sess, body, params }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  const id = okId(params.id), p = body.promo || {};
  const kind = p.kind === "voucher" ? "voucher" : "promo";
  const old = await env.DB.prepare("SELECT data FROM promos WHERE tenant_id = ? AND id = ?").bind(t.id, id).first();
  const clean = {
    id, kind, name: str(p.name, 60) || (kind === "voucher" ? "Voucher" : "Promo"), type: p.type === "amount" ? "amount" : "pct",
    value: num(p.value, 0, p.type === "amount" ? 1e9 : 100), maxDisc: num(p.maxDisc) || undefined, minSpend: num(p.minSpend),
    scope: ["all", "category", "product"].includes(p.scope) ? p.scope : "all", target: str(p.target, 60) || undefined,
    start: +p.start || undefined, end: +p.end || undefined, active: p.active !== false,
    code: kind === "voucher" ? (str(p.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, "") || fail(400, "Isi kode voucher")) : undefined,
    quota: kind === "voucher" ? Math.floor(num(p.quota)) || undefined : undefined, used: old ? parse(old.data).used || 0 : 0
  };
  if (!clean.value) fail(400, "Isi besar potongan");
  if (kind === "voucher") {
    const dup = (await env.DB.prepare("SELECT data FROM promos WHERE tenant_id = ? AND id != ?").bind(t.id, id).all()).results.map(r => parse(r.data)).find(x => x.kind === "voucher" && x.code === clean.code);
    if (dup) fail(409, "Kode voucher sudah dipakai");
  }
  await env.DB.prepare("INSERT INTO promos (tenant_id, id, data) VALUES (?, ?, ?) ON CONFLICT (tenant_id, id) DO UPDATE SET data = excluded.data").bind(t.id, id, JSON.stringify(clean)).run();
  return json({ promo: clean });
});
on("DELETE", "promos/:id", async ({ env, sess, params }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  await env.DB.prepare("DELETE FROM promos WHERE tenant_id = ? AND id = ?").bind(t.id, params.id).run();
  return json({ ok: true });
});

on("PUT", "suppliers/:id", async ({ env, sess, body, params }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  const id = okId(params.id), s = body.supplier || {};
  const clean = { id, name: str(s.name, 80) || fail(400, "Nama supplier wajib diisi"), phone: str(s.phone, 30) || undefined, address: str(s.address, 200) || undefined, note: str(s.note, 200) || undefined };
  await env.DB.prepare("INSERT INTO suppliers (tenant_id, id, data) VALUES (?, ?, ?) ON CONFLICT (tenant_id, id) DO UPDATE SET data = excluded.data").bind(t.id, id, JSON.stringify(clean)).run();
  return json({ supplier: clean });
});
on("DELETE", "suppliers/:id", async ({ env, sess, params }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  await env.DB.prepare("DELETE FROM suppliers WHERE tenant_id = ? AND id = ?").bind(t.id, params.id).run();
  return json({ ok: true });
});

/* ---------- stock documents: goods in, stock count, transfer ---------- */
function docItems(products, items, needQty = true) {
  return (Array.isArray(items) ? items : []).map(i => {
    const p = products.get(String(i.pid)); if (!p || p.track === false) return null;
    const u = i.unit && Array.isArray(p.units) ? p.units.find(x => x.name === i.unit) : null;
    const factor = u ? u.qty : 1;
    return { pid: p.id, name: p.name, unit: u ? u.name : p.unit || "pcs", factor, qty: num(i.qty, needQty ? 0 : -1e9, 1e9), cost: num(i.cost), counted: i.counted !== undefined ? num(i.counted, -1e9, 1e9) : undefined };
  }).filter(Boolean);
}

on("POST", "stock/in", async ({ env, sess, body }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  const outlet = await resolveOutlet(env, sess, body.outlet);
  const products = await loadProducts(env, t.id);
  const items = docItems(products, body.items).filter(i => i.qty > 0);
  if (!items.length) fail(400, "Tambahkan barang yang diterima");
  const cur = await stockMap(env, t.id, outlet);
  const id = newId("IN"), now = Date.now();
  const sup = body.supplierId ? await env.DB.prepare("SELECT data FROM suppliers WHERE tenant_id = ? AND id = ?").bind(t.id, String(body.supplierId)).first() : null;
  const doc = { id, kind: "in", time: now, outletId: outlet, supplier: sup ? { id: parse(sup.data).id, name: parse(sup.data).name } : null, invoice: str(body.invoice, 40) || undefined, note: str(body.note, 200) || undefined, by: sess.user.name, items, total: items.reduce((s, i) => s + i.qty * i.cost, 0) };
  const stmts = [env.DB.prepare("INSERT INTO stock_docs (tenant_id, id, time, kind, data) VALUES (?, ?, ?, 'in', ?)").bind(t.id, id, now, JSON.stringify(doc))];
  for (const i of items) {
    const baseQty = i.qty * i.factor, p = products.get(i.pid);
    stmts.push(stockStmt(env, t.id, outlet, i.pid, baseQty), moveStmt(env, t.id, { time: now, outlet, pid: i.pid, qty: baseQty, kind: "masuk", ref: id, user: sess.user.id, note: doc.supplier ? doc.supplier.name : undefined }));
    if (i.cost > 0 && body.updateCost !== false) {
      // Weighted average cost per base unit.
      const old = Math.max(0, cur[i.pid] || 0), unitCost = i.cost / i.factor;
      p.cost = Math.round(old > 0 ? (old * (p.cost || 0) + baseQty * unitCost) / (old + baseQty) : unitCost);
      stmts.push(env.DB.prepare("UPDATE products SET data = json_set(data, '$.cost', ?) WHERE tenant_id = ? AND id = ?").bind(p.cost, t.id, p.id));
    }
  }
  await env.DB.batch(stmts);
  return json({ doc, stock: await stockMap(env, t.id, outlet) });
});

on("POST", "stock/opname", async ({ env, sess, body }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  const outlet = await resolveOutlet(env, sess, body.outlet);
  const products = await loadProducts(env, t.id);
  const cur = await stockMap(env, t.id, outlet);
  const items = docItems(products, body.items, false).filter(i => i.counted !== undefined).map(i => ({ pid: i.pid, name: i.name, unit: products.get(i.pid).unit || "pcs", system: cur[i.pid] || 0, counted: i.counted, diff: i.counted - (cur[i.pid] || 0) }));
  if (!items.length) fail(400, "Isi hasil hitung minimal satu produk");
  const id = newId("OP"), now = Date.now();
  const doc = { id, kind: "opname", time: now, outletId: outlet, note: str(body.note, 200) || undefined, by: sess.user.name, items, lossValue: items.reduce((s, i) => s + Math.min(0, i.diff) * (products.get(i.pid).cost || 0), 0) };
  const stmts = [env.DB.prepare("INSERT INTO stock_docs (tenant_id, id, time, kind, data) VALUES (?, ?, ?, 'opname', ?)").bind(t.id, id, now, JSON.stringify(doc))];
  for (const i of items) if (i.diff) stmts.push(stockStmt(env, t.id, outlet, i.pid, i.diff), moveStmt(env, t.id, { time: now, outlet, pid: i.pid, qty: i.diff, kind: "opname", ref: id, user: sess.user.id }));
  await env.DB.batch(stmts);
  return json({ doc, stock: await stockMap(env, t.id, outlet) });
});

on("POST", "stock/transfer", async ({ env, sess, body }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  const from = await resolveOutlet(env, sess, body.from), to = await resolveOutlet(env, sess, body.to);
  if (from === to) fail(400, "Outlet asal dan tujuan harus berbeda");
  const products = await loadProducts(env, t.id);
  const items = docItems(products, body.items).filter(i => i.qty > 0);
  if (!items.length) fail(400, "Tambahkan barang yang dipindah");
  const outlets = await listOutlets(env, t.id), name = id => (outlets.find(o => o.id === id) || {}).name || id;
  const id = newId("TF"), now = Date.now();
  const doc = { id, kind: "transfer", time: now, from, to, fromName: name(from), toName: name(to), note: str(body.note, 200) || undefined, by: sess.user.name, items };
  const stmts = [env.DB.prepare("INSERT INTO stock_docs (tenant_id, id, time, kind, data) VALUES (?, ?, ?, 'transfer', ?)").bind(t.id, id, now, JSON.stringify(doc))];
  for (const i of items) {
    const q = i.qty * i.factor;
    stmts.push(stockStmt(env, t.id, from, i.pid, -q), moveStmt(env, t.id, { time: now, outlet: from, pid: i.pid, qty: -q, kind: "transfer keluar", ref: id, user: sess.user.id, note: "ke " + doc.toName }));
    stmts.push(stockStmt(env, t.id, to, i.pid, q), moveStmt(env, t.id, { time: now, outlet: to, pid: i.pid, qty: q, kind: "transfer masuk", ref: id, user: sess.user.id, note: "dari " + doc.fromName }));
  }
  await env.DB.batch(stmts);
  return json({ doc });
});

on("GET", "stock/docs", async ({ env, sess, url }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  const from = +url.searchParams.get("from") || Date.now() - 30 * DAY, to = +url.searchParams.get("to") || Date.now();
  const rows = (await env.DB.prepare("SELECT data FROM stock_docs WHERE tenant_id = ? AND time >= ? AND time <= ? ORDER BY time DESC LIMIT 500").bind(t.id, from, to).all()).results;
  return json({ docs: rows.map(r => parse(r.data)) });
});

on("GET", "stock/moves", async ({ env, sess, url }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  const outlet = await resolveOutlet(env, sess, url.searchParams.get("outlet"));
  const from = +url.searchParams.get("from") || Date.now() - 30 * DAY, to = +url.searchParams.get("to") || Date.now();
  let sql = "SELECT * FROM moves WHERE tenant_id = ? AND outlet_id = ? AND time >= ? AND time <= ?", b = [t.id, outlet, from, to];
  if (url.searchParams.get("pid")) { sql += " AND product_id = ?"; b.push(url.searchParams.get("pid")); }
  const rows = (await env.DB.prepare(sql + " ORDER BY time DESC LIMIT 1000").bind(...b).all()).results;
  return json({ moves: rows.map(m => ({ id: m.id, time: m.time, pid: m.product_id, qty: m.qty, kind: m.kind, ref: m.ref, note: m.note, userId: m.user_id })) });
});

/* ---------- reports ---------- */
on("GET", "reports", async ({ env, sess, url }) => {
  const t = requireTenant(sess, { roles: MANAGERS });
  const from = +url.searchParams.get("from") || Date.now() - 7 * DAY, to = +url.searchParams.get("to") || Date.now();
  if (to - from > 400 * DAY) fail(400, "Rentang maksimal 1 tahun");
  const outletQ = url.searchParams.get("outlet") || "all";
  let sql = "SELECT data FROM transactions WHERE tenant_id = ? AND time >= ? AND time <= ?", b = [t.id, from, to];
  if (outletQ !== "all") { sql += " AND COALESCE(json_extract(data, '$.outletId'), 'main') = ?"; b.push(await resolveOutlet(env, sess, outletQ)); }
  const trx = (await env.DB.prepare(sql + " ORDER BY time LIMIT 50000").bind(...b).all()).results.map(r => parse(r.data));
  const tzOffset = 7 * 3600000; // WIB
  const R = { count: 0, gross: 0, discount: 0, service: 0, tax: 0, refunds: 0, net: 0, cost: 0, profit: 0, items: 0, byDay: {}, byHour: {}, byMethod: {}, byCashier: {}, byProduct: {}, byCategory: {}, byOutlet: {}, voids: [] };
  for (const x of trx) {
    const refund = x.refunded || 0;
    const ratio = x.total ? (x.total - refund) / x.total : 1;
    const net = x.total - refund;
    const cost = (x.items || []).reduce((s, l) => s + (l.cost || 0) * l.qty, 0) * ratio;
    R.count++; R.gross += x.subtotal || 0; R.discount += x.discount || 0; R.service += x.service || 0; R.tax += x.tax || 0; R.refunds += refund; R.net += net; R.cost += cost;
    const day = new Date(x.time + tzOffset).toISOString().slice(0, 10), hour = new Date(x.time + tzOffset).getUTCHours();
    const add = (o, k, v, c = 1) => { o[k] = o[k] || { count: 0, total: 0 }; o[k].count += c; o[k].total += v; };
    add(R.byDay, day, net); add(R.byHour, hour, net); add(R.byMethod, x.method, net); add(R.byCashier, x.cashierName || x.cashierId, net); add(R.byOutlet, x.outletId || MAIN, net);
    for (const l of x.items || []) {
      const q = l.qty * ratio, rev = l.amount * (x.subtotal ? (x.total - (x.tax || 0) - (x.service || 0)) / x.subtotal : 1) * ratio;
      R.items += q;
      const k = l.name + (l.unit ? " (" + l.unit + ")" : "");
      R.byProduct[k] = R.byProduct[k] || { qty: 0, total: 0, cost: 0, cat: l.cat };
      R.byProduct[k].qty += q; R.byProduct[k].total += rev; R.byProduct[k].cost += (l.cost || 0) * q;
      add(R.byCategory, l.cat || "Umum", rev, q);
    }
    if (refund) R.voids.push({ id: x.id, time: x.time, total: x.total, refunded: refund, status: x.status, reasons: (x.refunds || []).map(r => r.reason + " (" + r.approvedBy + ")").join("; ") });
  }
  const taxes = R.tax + R.service;
  R.profit = Math.round(R.net - taxes - R.cost);
  R.cost = Math.round(R.cost);
  const shifts = (await env.DB.prepare("SELECT * FROM shifts WHERE tenant_id = ? AND opened >= ? AND opened <= ? ORDER BY opened").bind(t.id, from, to).all()).results.map(s => ({ ...shiftOut(s), summary: parse(s.data).summary || null }));
  return json({ from, to, report: R, shifts });
});

/* ---------- staff, outlets, settings ---------- */
on("POST", "staff", async ({ env, sess, body }) => {
  const t = requireTenant(sess, { roles: ["owner"] });
  const email = normEmail(body.email); checkEmail(email); checkPassword(body.password);
  const role = STAFF_ROLES.includes(body.role) ? body.role : "cashier";
  const name = str(body.name); if (!name) fail(400, "Nama staf wajib diisi");
  if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) fail(409, "Email sudah dipakai akun lain");
  const uid = newId("u"), salt = randHex(16);
  const outletId = body.outletId ? await resolveOutlet(env, sess, body.outletId) : null;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, name, role, tenant_id, pass_hash, pass_salt, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(uid, email, name, role, t.id, await hashPassword(body.password, salt), salt, Date.now()),
    env.DB.prepare("INSERT INTO user_meta (user_id, tenant_id, data) VALUES (?, ?, ?)").bind(uid, t.id, JSON.stringify({ outletId }))
  ]);
  return json({ user: { id: uid, name, email, role, tenantId: t.id, outletId, hasPin: false } });
});

on("POST", "staff/:id", async ({ env, sess, body, params }) => {
  const t = requireTenant(sess, { roles: ["owner"] });
  const u = await env.DB.prepare("SELECT * FROM users WHERE id = ? AND tenant_id = ? AND role != 'owner'").bind(params.id, t.id).first();
  if (!u) fail(404, "Staf tidak ditemukan");
  if (body.password) { checkPassword(body.password); await setPassword(env, u.id, body.password); }
  const meta = await getMeta(env, u.id);
  if (body.outletId !== undefined) meta.outletId = body.outletId ? await resolveOutlet(env, sess, body.outletId) : null;
  const role = STAFF_ROLES.includes(body.role) ? body.role : u.role;
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET role = ?, name = ? WHERE id = ?").bind(role, str(body.name) || u.name, u.id),
    env.DB.prepare("INSERT INTO user_meta (user_id, tenant_id, data) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data").bind(u.id, t.id, JSON.stringify(meta))
  ]);
  return json({ user: userOut({ ...u, role, name: str(body.name) || u.name }, meta) });
});

on("DELETE", "staff/:id", async ({ env, sess, params }) => {
  const t = requireTenant(sess, { roles: ["owner"] });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND user_id IN (SELECT id FROM users WHERE tenant_id = ? AND role != 'owner')").bind(params.id, t.id),
    env.DB.prepare("DELETE FROM user_meta WHERE user_id = ? AND tenant_id = ? AND user_id IN (SELECT id FROM users WHERE tenant_id = ? AND role != 'owner')").bind(params.id, t.id, t.id),
    env.DB.prepare("DELETE FROM users WHERE id = ? AND tenant_id = ? AND role != 'owner'").bind(params.id, t.id)
  ]);
  return json({ ok: true });
});

on("PUT", "outlets/:id", async ({ env, sess, body, params }) => {
  const t = requireTenant(sess, { roles: ["owner"] });
  const id = params.id === MAIN ? MAIN : okId(params.id);
  const old = await env.DB.prepare("SELECT data FROM outlets WHERE tenant_id = ? AND id = ?").bind(t.id, id).first();
  const o = { ...(old ? parse(old.data) : { created: Date.now() }), id, name: str(body.name, 60) || fail(400, "Nama outlet wajib diisi"), address: str(body.address, 200), phone: str(body.phone, 30) };
  delete o.deleted;
  await env.DB.prepare("INSERT INTO outlets (tenant_id, id, data) VALUES (?, ?, ?) ON CONFLICT (tenant_id, id) DO UPDATE SET data = excluded.data").bind(t.id, id, JSON.stringify(o)).run();
  return json({ outlet: o });
});
on("DELETE", "outlets/:id", async ({ env, sess, params }) => {
  const t = requireTenant(sess, { roles: ["owner"] });
  if (params.id === MAIN) fail(400, "Outlet utama tidak bisa dihapus");
  await env.DB.prepare("UPDATE outlets SET data = json_set(data, '$.deleted', 1) WHERE tenant_id = ? AND id = ?").bind(t.id, params.id).run();
  return json({ ok: true });
});

on("PUT", "settings", async ({ env, sess, body }) => {
  const t = requireTenant(sess, { roles: ["owner"], allowInactive: true });
  const s = await getSettings(env, t.id), b = body.settings || {};
  if (b.address !== undefined) s.address = str(b.address, 200);
  if (b.phone !== undefined) s.phone = str(b.phone, 30);
  if (b.receiptFooter !== undefined) s.receiptFooter = str(b.receiptFooter, 200);
  if (b.service !== undefined) s.service = num(b.service, 0, 30);
  if (b.requireShift !== undefined) s.requireShift = !!b.requireShift;
  if (Array.isArray(b.tables)) s.tables = b.tables.map((x, i) => ({ id: str(x.id, 20) || "m" + i, name: str(x.name, 20), area: str(x.area, 30) || "Dalam" })).filter(x => x.name).slice(0, 200);
  if (b.loyalty) s.loyalty = { enabled: !!b.loyalty.enabled, earnPer: Math.max(1000, num(b.loyalty.earnPer, 1000, 1e9)), pointValue: Math.max(1, num(b.loyalty.pointValue, 1, 1e6)) };
  if (b.midtrans) {
    if (b.midtrans.serverKey !== undefined) s.midtrans.serverKey = str(b.midtrans.serverKey, 200);
    if (b.midtrans.clientKey !== undefined) s.midtrans.clientKey = str(b.midtrans.clientKey, 200);
    if (b.midtrans.production !== undefined) s.midtrans.production = !!b.midtrans.production;
  }
  const stmts = [env.DB.prepare("INSERT INTO settings (tenant_id, data) VALUES (?, ?) ON CONFLICT (tenant_id) DO UPDATE SET data = excluded.data").bind(t.id, JSON.stringify(s))];
  if (b.tax !== undefined) stmts.push(env.DB.prepare("UPDATE tenants SET tax = ? WHERE id = ?").bind(num(b.tax, 0, 30), t.id));
  if (b.name !== undefined && str(b.name)) stmts.push(env.DB.prepare("UPDATE tenants SET name = ? WHERE id = ?").bind(str(b.name), t.id));
  await env.DB.batch(stmts);
  return json({ settings: settingsOut(s), tenant: tenantOut(await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(t.id).first()) });
});

// Wipe all business data (any plan). Needs the owner's password; accounts, outlets and settings stay.
on("POST", "settings/reset", async ({ env, sess, body }) => {
  const t = requireTenant(sess, { roles: ["owner"], allowInactive: true });
  if (!safeEqual(await hashPassword(String(body.password || ""), sess.real.pass_salt), sess.real.pass_hash)) fail(403, "Kata sandi salah");
  await env.DB.batch(["transactions", "products", "stock", "moves", "stock_docs", "shifts", "bills", "kitchen", "customers", "promos", "suppliers"]
    .map(tb => env.DB.prepare(`DELETE FROM ${tb} WHERE tenant_id = ?`).bind(t.id)));
  return json({ ok: true });
});

/* ---------- Midtrans: customer QRIS and subscription checkout ---------- */
const mtBase = prod => prod ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
const snapBase = prod => prod ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
const mtAuth = key => "Basic " + btoa(key + ":");
async function mtFetch(url, key, init = {}) {
  const r = await fetch(url, { ...init, headers: { accept: "application/json", "content-type": "application/json", authorization: mtAuth(key), ...(init.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok && !d.status_code) fail(502, "Midtrans menolak permintaan: " + (d.error_messages || [r.status]).join(", "));
  return d;
}
const mtStatus = s => ["capture", "settlement"].includes(s) ? "settlement" : ["deny", "cancel", "expire", "failure"].includes(s) ? s : "pending";

async function applySubscription(env, p) {
  const d = parse(p.data);
  if (d.applied) return;
  const t = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(p.tenant_id).first();
  if (!t) return;
  const plan = planKey(d.plan);
  const from = Math.max(Date.now(), t.paid_until);
  d.applied = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE tenants SET plan = ?, paid_until = ?, pay_request = NULL, status = 'aktif' WHERE id = ?").bind(plan, from + PLANS[plan].days * DAY, t.id),
    env.DB.prepare("UPDATE payments SET status = 'settlement', data = ? WHERE id = ?").bind(JSON.stringify(d), p.id)
  ]);
}

async function refreshPayment(env, p) {
  if (p.status !== "pending") return p.status;
  let key, prod;
  if (p.kind === "sub") { key = env.MIDTRANS_SERVER_KEY; prod = env.MIDTRANS_PRODUCTION === "true"; }
  else { const s = await getSettings(env, p.tenant_id); key = s.midtrans.serverKey; prod = s.midtrans.production; }
  if (!key) return p.status;
  const d = await mtFetch(mtBase(prod) + "/v2/" + encodeURIComponent(p.id) + "/status", key);
  const st = mtStatus(d.transaction_status);
  if (st !== p.status) {
    if (st === "settlement" && p.kind === "sub") await applySubscription(env, p);
    else await env.DB.prepare("UPDATE payments SET status = ? WHERE id = ?").bind(st, p.id).run();
  }
  return st;
}

on("POST", "qris/create", async ({ env, sess, body }) => {
  const t = requireTenant(sess);
  const s = await getSettings(env, t.id);
  if (!s.midtrans.serverKey) fail(400, "QRIS otomatis belum diatur. Isi kunci Midtrans di Pengaturan.");
  const amount = Math.round(num(body.amount)); if (amount < 1000) fail(400, "Nominal QRIS minimal Rp1.000");
  const id = "Q-" + t.id.slice(1, 9) + "-" + Date.now().toString(36) + randHex(2);
  const d = await mtFetch(mtBase(s.midtrans.production) + "/v2/charge", s.midtrans.serverKey, { method: "POST", body: JSON.stringify({ payment_type: "qris", transaction_details: { order_id: id, gross_amount: amount }, qris: { acquirer: "gopay" } }) });
  if (!d.qr_string && !(d.actions || []).length) fail(502, d.status_message || "Midtrans tidak mengembalikan kode QR");
  const qrUrl = ((d.actions || []).find(a => a.name === "generate-qr-code") || {}).url;
  await env.DB.prepare("INSERT INTO payments (id, tenant_id, kind, amount, status, created, data) VALUES (?, ?, 'qris', ?, 'pending', ?, ?)").bind(id, t.id, amount, Date.now(), JSON.stringify({ ref: str(body.ref, 48), qrString: d.qr_string, qrUrl, expiry: d.expiry_time })).run();
  return json({ id, amount, qrString: d.qr_string || null, qrUrl: qrUrl || null });
});

on("GET", "qris/:id", async ({ env, sess, params }) => {
  const t = requireTenant(sess);
  const p = await env.DB.prepare("SELECT * FROM payments WHERE id = ? AND tenant_id = ?").bind(params.id, t.id).first();
  if (!p) fail(404, "Pembayaran tidak ditemukan");
  return json({ status: await refreshPayment(env, p) });
});

on("POST", "billing/request", async ({ env, sess, body }) => {
  const t = requireTenant(sess, { roles: ["owner"], allowInactive: true });
  if (!PLANS[body.plan]) fail(400, "Paket tidak dikenal");
  const P = await getPlans(env);
  if (env.MIDTRANS_SERVER_KEY) {
    // Online checkout (Snap): QRIS, e-wallet, VA, card. Subscription extends automatically when paid.
    const prod = env.MIDTRANS_PRODUCTION === "true";
    const id = "SUB-" + t.id.slice(1, 9) + "-" + Date.now().toString(36);
    const owner = sess.user;
    const r = await fetch(snapBase(prod) + "/snap/v1/transactions", { method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: mtAuth(env.MIDTRANS_SERVER_KEY) },
      body: JSON.stringify({ transaction_details: { order_id: id, gross_amount: P[body.plan].price }, item_details: [{ id: body.plan, price: P[body.plan].price, quantity: 1, name: "Kasvara " + P[body.plan].name }], customer_details: { first_name: owner.name, email: owner.email } }) });
    const d = await r.json().catch(() => ({}));
    if (!d.redirect_url) fail(502, "Gagal membuat tagihan: " + (d.error_messages || [r.status]).join(", "));
    await env.DB.prepare("INSERT INTO payments (id, tenant_id, kind, amount, status, created, data) VALUES (?, ?, 'sub', ?, 'pending', ?, ?)").bind(id, t.id, P[body.plan].price, Date.now(), JSON.stringify({ plan: body.plan, redirect: d.redirect_url })).run();
    const req = { plan: body.plan, amount: P[body.plan].price, at: Date.now(), orderId: id, redirect: d.redirect_url };
    await env.DB.prepare("UPDATE tenants SET pay_request = ? WHERE id = ?").bind(JSON.stringify(req), t.id).run();
    return json({ payRequest: req, redirect: d.redirect_url });
  }
  const req = { plan: body.plan, amount: P[body.plan].price, at: Date.now() };
  await env.DB.prepare("UPDATE tenants SET pay_request = ? WHERE id = ?").bind(JSON.stringify(req), t.id).run();
  return json({ payRequest: req });
});

on("GET", "billing/status", async ({ env, sess }) => {
  const t = requireTenant(sess, { roles: ["owner"], allowInactive: true });
  const p = await env.DB.prepare("SELECT * FROM payments WHERE tenant_id = ? AND kind = 'sub' ORDER BY created DESC LIMIT 1").bind(t.id).first();
  const status = p ? await refreshPayment(env, p) : null;
  return json({ status, tenant: tenantOut(await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(t.id).first()) });
});

// Midtrans HTTP notification. Configure this URL in each Midtrans dashboard: <site>/api/midtrans/notify
on("POST", "midtrans/notify", async ({ env, body }) => {
  const p = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(String(body.order_id || "")).first();
  if (!p) return json({ ok: true });
  const key = p.kind === "sub" ? env.MIDTRANS_SERVER_KEY : (await getSettings(env, p.tenant_id)).midtrans.serverKey;
  if (!key) fail(400, "Kunci tidak diatur");
  const sig = await sha512(String(body.order_id) + String(body.status_code) + String(body.gross_amount) + key);
  if (!safeEqual(sig, String(body.signature_key || ""))) fail(403, "Tanda tangan tidak valid");
  const st = mtStatus(body.transaction_status);
  if (st === "settlement" && p.kind === "sub") await applySubscription(env, p);
  else await env.DB.prepare("UPDATE payments SET status = ? WHERE id = ?").bind(st, p.id).run();
  return json({ ok: true });
});

/* ---------- app owner console ---------- */
on("GET", "admin/tenants", async ({ env, sess }) => {
  requireSuper(sess);
  const ts = (await env.DB.prepare("SELECT * FROM tenants ORDER BY created DESC").all()).results;
  const users = (await env.DB.prepare("SELECT id, name, email, role, tenant_id FROM users WHERE tenant_id IS NOT NULL").all()).results;
  const trx = (await env.DB.prepare("SELECT tenant_id, time, total FROM transactions WHERE time > ?").bind(Date.now() - 7 * DAY).all()).results;
  return json({
    tenants: ts.map(t => {
      const own = users.filter(u => u.tenant_id === t.id);
      const o = own.find(u => u.role === "owner");
      return { ...tenantOut(t), users: own.length, owner: o ? { id: o.id, name: o.name, email: o.email } : null };
    }),
    transactions: trx.map(x => ({ tenantId: x.tenant_id, time: x.time, total: x.total }))
  });
});

on("POST", "admin/tenants/:id", async ({ env, sess, body, params }) => {
  requireSuper(sess);
  const t = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(params.id).first();
  if (!t) fail(404, "Usaha tidak ditemukan");
  if (body.action === "suspend" || body.action === "activate") {
    await env.DB.prepare("UPDATE tenants SET status = ? WHERE id = ?").bind(body.action === "suspend" ? "ditangguhkan" : "aktif", t.id).run();
  } else if (body.action === "extend") {
    // Activate or extend a paid subscription by N billing periods of the chosen plan.
    const plan = planKey(body.plan);
    const periods = Math.min(Math.max(Math.floor(+body.periods || 1), 1), 36);
    const from = Math.max(Date.now(), t.paid_until);
    await env.DB.prepare("UPDATE tenants SET plan = ?, paid_until = ?, pay_request = NULL, status = 'aktif' WHERE id = ?").bind(plan, from + periods * PLANS[plan].days * DAY, t.id).run();
  } else if (body.action === "trial") {
    // Extend the free trial by N days, counted from now if it already ended.
    const days = Math.min(Math.max(Math.floor(+body.days || 7), 1), 365);
    await env.DB.prepare("UPDATE tenants SET trial_ends = ?, status = 'aktif' WHERE id = ?").bind(Math.max(Date.now(), t.trial_ends) + days * DAY, t.id).run();
  } else if (body.action === "endsub") {
    await env.DB.prepare("UPDATE tenants SET paid_until = 0 WHERE id = ?").bind(t.id).run();
  } else fail(400, "Aksi tidak dikenal");
  return json({ tenant: tenantOut(await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(t.id).first()) });
});

// One-time password link for a business owner who forgot their password (send it to them by WhatsApp).
on("POST", "admin/reset-link", async ({ env, sess, request, body }) => {
  requireSuper(sess);
  const o = await env.DB.prepare("SELECT id FROM users WHERE tenant_id = ? AND role = 'owner'").bind(String(body.tenantId)).first();
  if (!o) fail(404, "Pemilik usaha tidak ditemukan");
  return json({ link: await makeResetLink(env, request, o.id, 24) });
});

on("POST", "admin/impersonate", async ({ env, sess, body }) => {
  requireSuper(sess);
  const o = await env.DB.prepare("SELECT id FROM users WHERE tenant_id = ? AND role = 'owner'").bind(String(body.tenantId)).first();
  if (!o) fail(404, "Pemilik usaha tidak ditemukan");
  await env.DB.prepare("UPDATE sessions SET acting_as = ? WHERE token_hash = ?").bind(o.id, sess.hash).run();
  return json({ ok: true });
});

on("POST", "admin/unimpersonate", async ({ env, sess }) => {
  requireSuper(sess);
  await env.DB.prepare("UPDATE sessions SET acting_as = NULL WHERE token_hash = ?").bind(sess.hash).run();
  return json({ ok: true });
});

// Origins of the bundled Android app (Capacitor). Only these get CORS, and never with credentials.
const APP_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost"];
function withCors(request, res) {
  const origin = request.headers.get("origin");
  if (!APP_ORIGINS.includes(origin)) return res;
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", origin);
  h.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  h.set("access-control-allow-headers", "content-type, authorization");
  h.set("access-control-expose-headers", "x-kasira-token");
  h.set("access-control-max-age", "86400");
  h.append("vary", "origin");
  // Mirror the session cookie as a header the app can read and keep.
  const m = (h.get("set-cookie") || "").match(/ks=([0-9a-f]{64})?;/);
  if (m) { h.set("x-kasira-token", m[1] || "-"); h.delete("set-cookie"); }
  return new Response(res.body, { status: res.status, headers: h });
}

export async function onRequest(ctx) {
  if (ctx.request.method === "OPTIONS") return withCors(ctx.request, new Response(null, { status: 204 }));
  return withCors(ctx.request, await handle(ctx));
}

async function handle({ request, env, params }) {
  try {
    const path = (params.path || []).join("/");
    const route = routes.map(r => ({ r, m: path.match(r.re) })).find(x => x.m && x.r.method === request.method);
    if (!route) fail(404, "Tidak ditemukan");
    let body = {};
    if (request.method !== "GET" && request.method !== "DELETE") {
      // JSON-only bodies force a CORS preflight, which blocks cross-site form posts.
      if (!(request.headers.get("content-type") || "").includes("application/json")) fail(415, "Harus JSON");
      body = await request.json().catch(() => ({}));
    }
    const sess = path === "midtrans/notify" ? null : await loadSession(request, env);
    return await route.r.fn({ request, env, body, sess, params: route.m.groups || {}, url: new URL(request.url) });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Terjadi kesalahan di server" }, 500);
  }
}

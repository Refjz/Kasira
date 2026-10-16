// Kasira POS API: Cloudflare Pages Function backed by D1 (binding DB).
// Auth uses PBKDF2 password hashes and an HttpOnly session cookie.
// Env: DB (D1), OWNER_EMAIL (secret; the only email that may claim the app-owner account).

const DAY = 86400000;
const TRIAL_DAYS = 7;
const SESSION_DAYS = 30;
// Every plan has all features; plans differ only in billing period.
const PLANS = { bulanan: { name: "Bulanan", price: 99000, days: 30 }, tahunan: { name: "Tahunan", price: 990000, days: 365 } };
const planKey = k => PLANS[k] ? k : "bulanan";
const STAFF_ROLES = ["manager", "cashier"];
const TYPES = ["F&B", "Minimarket", "Retail", "Jasa"];

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const newId = p => p + randHex(6);
const sha256 = async s => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const normEmail = e => String(e || "").trim().toLowerCase();
const str = (v, max = 120) => String(v ?? "").trim().slice(0, max);
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
    payRequest: t.pay_request ? (r => ({ ...r, plan: planKey(r.plan) }))(JSON.parse(t.pay_request)) : null
  };
}
const userOut = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, tenantId: u.tenant_id });

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
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)ks=([0-9a-f]{64})/);
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

function starterProducts(type) {
  if (type === "F&B") return [
    { name: "Es Teh Manis", cat: "Minuman", price: 5000, cost: 1500, stock: 100 },
    { name: "Kopi Susu", cat: "Minuman", price: 15000, cost: 6000, stock: 100 },
    { name: "Nasi Goreng", cat: "Makanan", price: 20000, cost: 9000, stock: 50 },
    { name: "Mi Goreng", cat: "Makanan", price: 18000, cost: 8000, stock: 50 }
  ];
  if (type === "Jasa") return [
    { name: "Layanan Standar", cat: "Layanan", price: 25000, cost: 8000, stock: 999 },
    { name: "Layanan Premium", cat: "Layanan", price: 50000, cost: 15000, stock: 999 }
  ];
  return [
    { name: "Air Mineral 600 ml", cat: "Minuman", price: 4000, cost: 2500, stock: 48 },
    { name: "Mi Instan Goreng", cat: "Makanan", price: 3500, cost: 2800, stock: 40 },
    { name: "Gula Pasir 1 kg", cat: "Sembako", price: 17500, cost: 15000, stock: 20 }
  ];
}

const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn });

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
    ...starterProducts(type).map(p => { const id = newId("p"); return env.DB.prepare("INSERT INTO products (tenant_id, id, data) VALUES (?, ?, ?)").bind(tid, id, JSON.stringify({ id, tenantId: tid, ...p })); })
  ];
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

on("GET", "me", async ({ env, sess }) => {
  if (!sess) fail(401, "Belum masuk");
  const out = { user: userOut(sess.user), impersonating: sess.impersonating, tenant: null, staff: [] };
  if (sess.tenant) {
    out.tenant = tenantOut(sess.tenant);
    const { results } = await env.DB.prepare("SELECT * FROM users WHERE tenant_id = ? ORDER BY created").bind(sess.tenant.id).all();
    out.staff = results.map(userOut);
  }
  return json(out);
});

on("GET", "data", async ({ env, sess }) => {
  const t = requireTenant(sess);
  const prods = await env.DB.prepare("SELECT data FROM products WHERE tenant_id = ?").bind(t.id).all();
  const trx = await env.DB.prepare("SELECT data FROM transactions WHERE tenant_id = ? AND time > ? ORDER BY time DESC LIMIT 3000").bind(t.id, Date.now() - 30 * DAY).all();
  return json({ products: prods.results.map(r => JSON.parse(r.data)), transactions: trx.results.map(r => JSON.parse(r.data)) });
});

on("PUT", "products/:id", async ({ env, sess, body, params }) => {
  const t = requireTenant(sess, { roles: ["owner", "manager"] });
  const p = body.product || {};
  const clean = { ...p, id: params.id, tenantId: t.id, name: str(p.name), cat: str(p.cat, 60), price: Math.max(0, +p.price || 0), cost: Math.max(0, +p.cost || 0), stock: Math.max(0, Math.floor(+p.stock || 0)) };
  if (!clean.name) fail(400, "Nama produk wajib diisi");
  await env.DB.prepare("INSERT INTO products (tenant_id, id, data) VALUES (?, ?, ?) ON CONFLICT (tenant_id, id) DO UPDATE SET data = excluded.data")
    .bind(t.id, params.id, JSON.stringify(clean)).run();
  return json({ product: clean });
});

on("DELETE", "products/:id", async ({ env, sess, params }) => {
  const t = requireTenant(sess, { roles: ["owner", "manager"] });
  await env.DB.prepare("DELETE FROM products WHERE tenant_id = ? AND id = ?").bind(t.id, params.id).run();
  return json({ ok: true });
});

on("POST", "trx", async ({ env, sess, body }) => {
  const t = requireTenant(sess);
  const x = body.trx || {};
  if (!x.id || !Array.isArray(x.items) || !x.items.length) fail(400, "Transaksi tidak valid");
  const trx = { ...x, tenantId: t.id, cashierId: sess.user.id, time: Date.now() };
  const stmts = [env.DB.prepare("INSERT INTO transactions (tenant_id, id, time, cashier_id, total, data) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(t.id, trx.id, trx.time, trx.cashierId, Math.round(+trx.total || 0), JSON.stringify(trx))];
  for (const i of trx.items) {
    stmts.push(env.DB.prepare("UPDATE products SET data = json_set(data, '$.stock', MAX(0, json_extract(data, '$.stock') - ?)) WHERE tenant_id = ? AND id = ? AND json_extract(data, '$.stock') < 999")
      .bind(Math.max(0, +i.qty || 0), t.id, String(i.pid)));
  }
  await env.DB.batch(stmts);
  return json({ trx });
});

on("PATCH", "trx/:id", async ({ env, sess, body, params }) => {
  const t = requireTenant(sess);
  const k = ["baru", "proses", "siap", "selesai"].includes(body.kitchen) ? body.kitchen : fail(400, "Status dapur tidak valid");
  await env.DB.prepare("UPDATE transactions SET data = json_set(data, '$.kitchen', ?) WHERE tenant_id = ? AND id = ?").bind(k, t.id, params.id).run();
  return json({ ok: true });
});

on("POST", "staff", async ({ env, sess, body }) => {
  const t = requireTenant(sess, { roles: ["owner"] });
  const email = normEmail(body.email); checkEmail(email); checkPassword(body.password);
  const role = STAFF_ROLES.includes(body.role) ? body.role : "cashier";
  const name = str(body.name); if (!name) fail(400, "Nama staf wajib diisi");
  if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) fail(409, "Email sudah dipakai akun lain");
  const uid = newId("u"), salt = randHex(16);
  await env.DB.prepare("INSERT INTO users (id, email, name, role, tenant_id, pass_hash, pass_salt, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(uid, email, name, role, t.id, await hashPassword(body.password, salt), salt, Date.now()).run();
  return json({ user: { id: uid, name, email, role, tenantId: t.id } });
});

on("DELETE", "staff/:id", async ({ env, sess, params }) => {
  const t = requireTenant(sess, { roles: ["owner"] });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND user_id IN (SELECT id FROM users WHERE tenant_id = ? AND role != 'owner')").bind(params.id, t.id),
    env.DB.prepare("DELETE FROM users WHERE id = ? AND tenant_id = ? AND role != 'owner'").bind(params.id, t.id)
  ]);
  return json({ ok: true });
});

on("POST", "billing/request", async ({ env, sess, body }) => {
  const t = requireTenant(sess, { roles: ["owner"], allowInactive: true });
  if (!PLANS[body.plan]) fail(400, "Paket tidak dikenal");
  const req = { plan: body.plan, amount: PLANS[body.plan].price, at: Date.now() };
  await env.DB.prepare("UPDATE tenants SET pay_request = ? WHERE id = ?").bind(JSON.stringify(req), t.id).run();
  return json({ payRequest: req });
});

on("POST", "settings/reset", async ({ env, sess }) => {
  const t = requireTenant(sess, { roles: ["owner"] });
  if (access(t) !== "trial") fail(403, "Kosongkan data hanya tersedia selama masa coba");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM transactions WHERE tenant_id = ?").bind(t.id),
    env.DB.prepare("DELETE FROM products WHERE tenant_id = ?").bind(t.id)
  ]);
  return json({ ok: true });
});

on("GET", "admin/tenants", async ({ env, sess }) => {
  requireSuper(sess);
  const ts = (await env.DB.prepare("SELECT * FROM tenants ORDER BY created DESC").all()).results;
  const users = (await env.DB.prepare("SELECT id, name, email, role, tenant_id FROM users WHERE tenant_id IS NOT NULL").all()).results;
  const trx = (await env.DB.prepare("SELECT tenant_id, time, total FROM transactions WHERE time > ?").bind(Date.now() - 7 * DAY).all()).results;
  return json({
    tenants: ts.map(t => {
      const own = users.filter(u => u.tenant_id === t.id);
      const o = own.find(u => u.role === "owner");
      return { ...tenantOut(t), users: own.length, owner: o ? { name: o.name, email: o.email } : null };
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

export async function onRequest({ request, env, params }) {
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
    const sess = await loadSession(request, env);
    return await route.r.fn({ request, env, body, sess, params: route.m.groups || {} });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Terjadi kesalahan di server" }, 500);
  }
}

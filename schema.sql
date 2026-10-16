-- Kasira POS, Cloudflare D1 schema.
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  city TEXT NOT NULL,
  tax INTEGER NOT NULL DEFAULT 0,
  plan TEXT NOT NULL DEFAULT 'pro',
  status TEXT NOT NULL DEFAULT 'aktif',
  trial_ends INTEGER NOT NULL,
  paid_until INTEGER NOT NULL DEFAULT 0,
  pay_request TEXT,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  tenant_id TEXT,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  acting_as TEXT,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS transactions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  time INTEGER NOT NULL,
  cashier_id TEXT,
  total INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS trx_tenant_time ON transactions(tenant_id, time);

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

-- v3: full POS (shifts, refunds, outlets, stock ledger, bills, kitchen, members, promos, suppliers, payments).
CREATE TABLE IF NOT EXISTS settings (
  tenant_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_meta (
  user_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outlets (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Stock on hand per outlet, in each product's base unit.
CREATE TABLE IF NOT EXISTS stock (
  tenant_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, outlet_id, product_id)
);

-- Every stock change: sale, refund, in, opname, transfer, recipe use.
CREATE TABLE IF NOT EXISTS moves (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  time INTEGER NOT NULL,
  outlet_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  qty REAL NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT,
  user_id TEXT,
  note TEXT,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS moves_time ON moves(tenant_id, time);
CREATE INDEX IF NOT EXISTS moves_product ON moves(tenant_id, product_id, time);

-- Stock documents: goods received, stock counts, transfers.
CREATE TABLE IF NOT EXISTS stock_docs (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  time INTEGER NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS docs_time ON stock_docs(tenant_id, time);

CREATE TABLE IF NOT EXISTS shifts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  opened INTEGER NOT NULL,
  closed INTEGER,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS shifts_user ON shifts(tenant_id, user_id, closed);
CREATE INDEX IF NOT EXISTS shifts_time ON shifts(tenant_id, opened);

-- Open bills (F&B tabs) until paid or cancelled.
CREATE TABLE IF NOT EXISTS bills (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS bills_open ON bills(tenant_id, outlet_id, status);

CREATE TABLE IF NOT EXISTS kitchen (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  time INTEGER NOT NULL,
  status TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS kitchen_open ON kitchen(tenant_id, outlet_id, status, time);

CREATE TABLE IF NOT EXISTS customers (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  phone TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone ON customers(tenant_id, phone);

-- Automatic promos and voucher codes (data.kind = 'promo' | 'voucher').
CREATE TABLE IF NOT EXISTS promos (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires INTEGER NOT NULL
);

-- Midtrans orders: customer QRIS (kind 'qris') and subscription checkout (kind 'sub').
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  created INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_tenant ON payments(tenant_id, created);

-- Clean public-release schema. No accounts, invitations, or payments are seeded.
CREATE TABLE tracker_settings (
  id INTEGER PRIMARY KEY,
  total_cents INTEGER NOT NULL DEFAULT 0,
  next_payment_cents INTEGER NOT NULL DEFAULT 0,
  next_payment_date TEXT NOT NULL DEFAULT ''
);
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_cents INTEGER NOT NULL,
  paid_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_by TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX payments_paid_on_idx ON payments(paid_on);
CREATE INDEX payments_status_idx ON payments(status);
CREATE TABLE invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  code_ciphertext TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  redeemed_by_email TEXT,
  redeemed_by_name TEXT,
  redeemed_at TEXT,
  revoked_at TEXT
);
CREATE INDEX invite_codes_status_idx ON invite_codes(status);
CREATE TABLE access_grants (
  email TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  invite_code_id INTEGER NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY (invite_code_id) REFERENCES invite_codes(id)
);
CREATE INDEX access_grants_active_idx ON access_grants(active);
CREATE TABLE invite_attempts (
  email TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_until TEXT
);

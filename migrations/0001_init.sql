-- RSS Childcare 101: trainees, quiz results, sessions and course settings.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trainees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  uni TEXT,
  pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  declared_at TEXT
);

CREATE TABLE IF NOT EXISTS results (
  trainee_id TEXT NOT NULL REFERENCES trainees(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  passed_at TEXT,
  last_at TEXT,
  PRIMARY KEY (trainee_id, module_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('trainee','admin')),
  trainee_id TEXT,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts(ip, at);

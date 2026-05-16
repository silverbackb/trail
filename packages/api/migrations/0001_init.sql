CREATE TABLE IF NOT EXISTS visitor_touchpoints (
  id           TEXT PRIMARY KEY,
  visitor_id   TEXT NOT NULL,
  account_id   TEXT NOT NULL,
  lead_id      TEXT NULL,
  session_num  INTEGER NOT NULL DEFAULT 1,
  ch_source    TEXT,
  ch_medium    TEXT,
  ch_campaign  TEXT,
  ch_term      TEXT,
  ch_type      TEXT NOT NULL DEFAULT 'direct',
  gclid        TEXT,
  fbclid       TEXT,
  landing_url  TEXT,
  referrer     TEXT,
  hostname     TEXT,
  converted    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tp_visitor  ON visitor_touchpoints(visitor_id, account_id);
CREATE INDEX IF NOT EXISTS idx_tp_lead     ON visitor_touchpoints(lead_id);
CREATE INDEX IF NOT EXISTS idx_tp_account  ON visitor_touchpoints(account_id, created_at);

CREATE TABLE IF NOT EXISTS visitor_sessions (
  visitor_id   TEXT NOT NULL,
  account_id   TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(visitor_id, session_hash)
);

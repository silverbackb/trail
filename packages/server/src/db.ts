import Database from "better-sqlite3";

export function createDB(dbPath = "./trail.db"): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      account_id  TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      domain      TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS visitor_touchpoints (
      id           TEXT PRIMARY KEY,
      visitor_id   TEXT NOT NULL,
      account_id   TEXT NOT NULL,
      lead_id      TEXT,
      session_num  INTEGER NOT NULL,
      ch_source    TEXT,
      ch_medium    TEXT,
      ch_campaign  TEXT,
      ch_term      TEXT,
      ch_type      TEXT,
      gclid        TEXT,
      fbclid       TEXT,
      landing_url  TEXT,
      referrer     TEXT,
      hostname     TEXT,
      converted    INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS visitor_sessions (
      visitor_id   TEXT NOT NULL,
      account_id   TEXT NOT NULL,
      session_hash TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(visitor_id, session_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_tp_visitor  ON visitor_touchpoints(visitor_id, account_id);
    CREATE INDEX IF NOT EXISTS idx_tp_lead     ON visitor_touchpoints(lead_id);
    CREATE INDEX IF NOT EXISTS idx_tp_account  ON visitor_touchpoints(account_id, created_at);
  `);

  return db;
}

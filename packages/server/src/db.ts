import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface RecentLog {
  id: string; account_id: string; visitor_id: string;
  ch_type: string | null; ch_source: string | null; ch_campaign: string | null;
  landing_url: string | null; lead_id: string | null; converted: number;
  hostname: string | null; created_at: string; domain: string | null;
}

export interface AccountSummary {
  account_id: string; name: string; domain: string;
  visitors: number; leads: number; last_touch: string | null;
}

export interface TouchpointInsert {
  id: string; visitor_id: string; account_id: string; session_num: number;
  ch_source: string | null; ch_medium: string | null; ch_campaign: string | null;
  ch_term: string | null; ch_type: string; gclid: string | null; fbclid: string | null;
  landing_url: string | null; referrer: string | null; hostname: string | null;
}

export interface JourneyEntry {
  session_num: number; ch_type: string | null; ch_source: string | null;
  ch_medium: string | null; ch_campaign: string | null; ch_term: string | null;
  gclid: string | null; fbclid: string | null; landing_url: string | null;
  referrer: string | null; hostname: string | null;
  time_on_page_sec: number | null; scroll_depth_pct: number | null;
  created_at: string;
}

export interface AccountRow { account_id: string; name: string; domain: string; created_at: string; }
export interface SessionEntry { visitor_id: string; ch_type: string | null; ch_source: string | null; ch_campaign: string | null; landing_url: string | null; lead_id: string | null; created_at: string; }
export interface TouchpointEntry extends Record<string, unknown> { session_num: number; ch_type: string | null; ch_source: string | null; ch_campaign: string | null; landing_url: string | null; created_at: string; }
export interface ChannelRow { ch_type: string; leads: number; conversions: number; }
export interface PathRow { lead_id: string; path: string; }
export interface PerformanceRow { ch_type: string; visitors: number; leads: number; conversions: number; }
export interface LeadRow { lead_id: string; ch_type: string; created_at: string; }

export interface TrailDB {
  // api.ts
  getRecentLogs(limit: number): Promise<RecentLog[]>;
  getAccountsSummary(): Promise<AccountSummary[]>;
  sessionExists(visitorId: string, sessionHash: string): Promise<boolean>;
  countVisitorTouchpoints(visitorId: string, accountId: string): Promise<number>;
  insertTouchpoint(data: TouchpointInsert): Promise<void>;
  upsertSession(visitorId: string, accountId: string, sessionHash: string): Promise<void>;
  getJourneyByVisitor(visitorId: string, accountId?: string): Promise<JourneyEntry[]>;
  convertVisitor(leadId: string, visitorId: string, accountId: string, timeOnPageSec?: number, scrollDepthPct?: number): Promise<void>;
  // mcp.ts
  createAccount(accountId: string, name: string, domain: string): Promise<void>;
  listAccounts(): Promise<AccountRow[]>;
  getRecentSessions(accountId: string, limit: number): Promise<SessionEntry[]>;
  getJourneyByLead(leadId: string, accountId: string): Promise<TouchpointEntry[]>;
  getChannelReport(accountId: string): Promise<ChannelRow[]>;
  getTopPaths(accountId: string): Promise<PathRow[]>;
  getChannelPerformance(accountId: string): Promise<PerformanceRow[]>;
  listLeads(accountId: string, limit: number): Promise<LeadRow[]>;
}

// ── SQLite ────────────────────────────────────────────────────────────────────

const CREATE_TABLES_SQL = `
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
    converted         INTEGER NOT NULL DEFAULT 0,
    time_on_page_sec  INTEGER,
    scroll_depth_pct  INTEGER,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
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
`;

function createSQLiteDB(dbPath: string): TrailDB {
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(CREATE_TABLES_SQL);
  try { sqlite.exec("ALTER TABLE visitor_touchpoints ADD COLUMN time_on_page_sec INTEGER"); } catch {}
  try { sqlite.exec("ALTER TABLE visitor_touchpoints ADD COLUMN scroll_depth_pct INTEGER"); } catch {}

  const s = <T>(sql: string) => sqlite.prepare(sql) as unknown as { all: (...a: unknown[]) => T[]; get: (...a: unknown[]) => T | undefined; run: (...a: unknown[]) => void };

  return {
    async getRecentLogs(limit) {
      return s<RecentLog>(`
        SELECT t.id, t.account_id, t.visitor_id, t.ch_type, t.ch_source, t.ch_campaign,
               t.landing_url, t.lead_id, t.converted, t.hostname, t.created_at, a.domain
        FROM visitor_touchpoints t
        LEFT JOIN accounts a ON a.account_id = t.account_id
        ORDER BY t.created_at DESC LIMIT ?
      `).all(limit);
    },
    async getAccountsSummary() {
      return s<AccountSummary>(`
        SELECT a.account_id, a.name, a.domain,
          COUNT(DISTINCT t.visitor_id) AS visitors,
          COUNT(DISTINCT t.lead_id)   AS leads,
          MAX(t.created_at)           AS last_touch
        FROM accounts a
        LEFT JOIN visitor_touchpoints t ON t.account_id = a.account_id
        GROUP BY a.account_id ORDER BY last_touch DESC
      `).all();
    },
    async sessionExists(visitorId, sessionHash) {
      return !!s(`SELECT 1 FROM visitor_sessions WHERE visitor_id=? AND session_hash=?`).get(visitorId, sessionHash);
    },
    async countVisitorTouchpoints(visitorId, accountId) {
      const row = s<{ n: number }>(`SELECT COUNT(*) as n FROM visitor_touchpoints WHERE visitor_id=? AND account_id=?`).get(visitorId, accountId);
      return row?.n ?? 0;
    },
    async insertTouchpoint(d) {
      s(`INSERT INTO visitor_touchpoints (id,visitor_id,account_id,session_num,ch_source,ch_medium,ch_campaign,ch_term,ch_type,gclid,fbclid,landing_url,referrer,hostname) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(d.id, d.visitor_id, d.account_id, d.session_num, d.ch_source, d.ch_medium, d.ch_campaign, d.ch_term, d.ch_type, d.gclid, d.fbclid, d.landing_url, d.referrer, d.hostname);
    },
    async upsertSession(visitorId, accountId, sessionHash) {
      s(`INSERT OR IGNORE INTO visitor_sessions (visitor_id,account_id,session_hash) VALUES (?,?,?)`).run(visitorId, accountId, sessionHash);
    },
    async getJourneyByVisitor(visitorId, accountId) {
      const sql = accountId
        ? `SELECT session_num,ch_type,ch_source,ch_medium,ch_campaign,ch_term,gclid,fbclid,landing_url,referrer,hostname,time_on_page_sec,scroll_depth_pct,created_at FROM visitor_touchpoints WHERE visitor_id=? AND account_id=? ORDER BY session_num ASC`
        : `SELECT session_num,ch_type,ch_source,ch_medium,ch_campaign,ch_term,gclid,fbclid,landing_url,referrer,hostname,time_on_page_sec,scroll_depth_pct,created_at FROM visitor_touchpoints WHERE visitor_id=? ORDER BY session_num ASC`;
      return accountId ? s<JourneyEntry>(sql).all(visitorId, accountId) : s<JourneyEntry>(sql).all(visitorId);
    },
    async convertVisitor(leadId, visitorId, accountId, timeOnPageSec, scrollDepthPct) {
      s(`UPDATE visitor_touchpoints SET lead_id=?, converted=1, time_on_page_sec=COALESCE(?,time_on_page_sec), scroll_depth_pct=COALESCE(?,scroll_depth_pct) WHERE visitor_id=? AND account_id=? AND (lead_id IS NULL OR lead_id=visitor_id)`).run(leadId, timeOnPageSec ?? null, scrollDepthPct ?? null, visitorId, accountId);
    },
    async createAccount(accountId, name, domain) {
      s(`INSERT OR IGNORE INTO accounts (account_id, name, domain) VALUES (?, ?, ?)`).run(accountId, name, domain);
    },
    async listAccounts() {
      return s<AccountRow>(`SELECT account_id, name, domain, created_at FROM accounts ORDER BY created_at DESC`).all();
    },
    async getRecentSessions(accountId, limit) {
      return s<SessionEntry>(`SELECT visitor_id, ch_type, ch_source, ch_campaign, landing_url, lead_id, created_at FROM visitor_touchpoints WHERE account_id=? ORDER BY created_at DESC LIMIT ?`).all(accountId, limit);
    },
    async getJourneyByLead(leadId, accountId) {
      return s<TouchpointEntry>(`SELECT * FROM visitor_touchpoints WHERE lead_id=? AND account_id=? ORDER BY session_num ASC`).all(leadId, accountId);
    },
    async getChannelReport(accountId) {
      return s<ChannelRow>(`SELECT ch_type, COUNT(DISTINCT lead_id) as leads, SUM(CASE WHEN converted=1 THEN 1 ELSE 0 END) as conversions FROM visitor_touchpoints WHERE account_id=? AND lead_id IS NOT NULL GROUP BY ch_type ORDER BY conversions DESC`).all(accountId);
    },
    async getTopPaths(accountId) {
      return s<PathRow>(`SELECT lead_id, GROUP_CONCAT(ch_type, ' → ') as path FROM (SELECT lead_id, ch_type FROM visitor_touchpoints WHERE account_id=? AND lead_id IS NOT NULL ORDER BY lead_id, session_num) GROUP BY lead_id`).all(accountId);
    },
    async getChannelPerformance(accountId) {
      return s<PerformanceRow>(`SELECT ch_type, COUNT(DISTINCT visitor_id) as visitors, COUNT(DISTINCT lead_id) as leads, SUM(CASE WHEN converted=1 THEN 1 ELSE 0 END) as conversions FROM visitor_touchpoints WHERE account_id=? GROUP BY ch_type ORDER BY visitors DESC`).all(accountId);
    },
    async listLeads(accountId, limit) {
      return s<LeadRow>(`SELECT lead_id, ch_type, created_at FROM visitor_touchpoints WHERE account_id=? AND lead_id IS NOT NULL GROUP BY lead_id ORDER BY MAX(created_at) DESC LIMIT ?`).all(accountId, limit);
    },
  };
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────

const CREATE_TABLES_PG = `
  CREATE TABLE IF NOT EXISTS accounts (
    account_id  TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    domain      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    converted         INTEGER NOT NULL DEFAULT 0,
    time_on_page_sec  INTEGER,
    scroll_depth_pct  INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS visitor_sessions (
    visitor_id   TEXT NOT NULL,
    account_id   TEXT NOT NULL,
    session_hash TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(visitor_id, session_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_tp_visitor  ON visitor_touchpoints(visitor_id, account_id);
  CREATE INDEX IF NOT EXISTS idx_tp_lead     ON visitor_touchpoints(lead_id);
  CREATE INDEX IF NOT EXISTS idx_tp_account  ON visitor_touchpoints(account_id, created_at);
`;

function toISO(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().replace("T", " ").slice(0, 19);
  return String(v);
}

function createPostgresDB(url: string): TrailDB {
  const sql = postgres(url);
  let initialized = false;
  async function init() {
    if (initialized) return;
    await sql.unsafe(CREATE_TABLES_PG);
    await sql.unsafe("ALTER TABLE visitor_touchpoints ADD COLUMN IF NOT EXISTS time_on_page_sec INTEGER");
    await sql.unsafe("ALTER TABLE visitor_touchpoints ADD COLUMN IF NOT EXISTS scroll_depth_pct INTEGER");
    initialized = true;
  }

  return {
    async getRecentLogs(limit) {
      await init();
      const rows = await sql`
        SELECT t.id, t.account_id, t.visitor_id, t.ch_type, t.ch_source, t.ch_campaign,
               t.landing_url, t.lead_id, t.converted, t.hostname, t.created_at, a.domain
        FROM visitor_touchpoints t
        LEFT JOIN accounts a ON a.account_id = t.account_id
        ORDER BY t.created_at DESC LIMIT ${limit}
      `;
      return rows.map(r => ({ ...r, created_at: toISO(r.created_at) })) as RecentLog[];
    },
    async getAccountsSummary() {
      await init();
      const rows = await sql`
        SELECT a.account_id, a.name, a.domain,
          COUNT(DISTINCT t.visitor_id)::int AS visitors,
          COUNT(DISTINCT t.lead_id)::int    AS leads,
          MAX(t.created_at)                 AS last_touch
        FROM accounts a
        LEFT JOIN visitor_touchpoints t ON t.account_id = a.account_id
        GROUP BY a.account_id ORDER BY last_touch DESC
      `;
      return rows.map(r => ({ ...r, last_touch: r.last_touch ? toISO(r.last_touch) : null })) as AccountSummary[];
    },
    async sessionExists(visitorId, sessionHash) {
      await init();
      const rows = await sql`SELECT 1 FROM visitor_sessions WHERE visitor_id=${visitorId} AND session_hash=${sessionHash}`;
      return rows.length > 0;
    },
    async countVisitorTouchpoints(visitorId, accountId) {
      await init();
      const [row] = await sql`SELECT COUNT(*)::int as n FROM visitor_touchpoints WHERE visitor_id=${visitorId} AND account_id=${accountId}`;
      return (row as { n: number }).n ?? 0;
    },
    async insertTouchpoint(d) {
      await init();
      await sql`
        INSERT INTO visitor_touchpoints (id,visitor_id,account_id,session_num,ch_source,ch_medium,ch_campaign,ch_term,ch_type,gclid,fbclid,landing_url,referrer,hostname)
        VALUES (${d.id},${d.visitor_id},${d.account_id},${d.session_num},${d.ch_source},${d.ch_medium},${d.ch_campaign},${d.ch_term},${d.ch_type},${d.gclid},${d.fbclid},${d.landing_url},${d.referrer},${d.hostname})
      `;
    },
    async upsertSession(visitorId, accountId, sessionHash) {
      await init();
      await sql`INSERT INTO visitor_sessions (visitor_id,account_id,session_hash) VALUES (${visitorId},${accountId},${sessionHash}) ON CONFLICT DO NOTHING`;
    },
    async getJourneyByVisitor(visitorId, accountId) {
      await init();
      const rows = accountId
        ? await sql`SELECT session_num,ch_type,ch_source,ch_medium,ch_campaign,ch_term,gclid,fbclid,landing_url,referrer,hostname,time_on_page_sec,scroll_depth_pct,created_at FROM visitor_touchpoints WHERE visitor_id=${visitorId} AND account_id=${accountId} ORDER BY session_num ASC`
        : await sql`SELECT session_num,ch_type,ch_source,ch_medium,ch_campaign,ch_term,gclid,fbclid,landing_url,referrer,hostname,time_on_page_sec,scroll_depth_pct,created_at FROM visitor_touchpoints WHERE visitor_id=${visitorId} ORDER BY session_num ASC`;
      return rows.map(r => ({ ...r, created_at: toISO(r.created_at) })) as JourneyEntry[];
    },
    async convertVisitor(leadId, visitorId, accountId, timeOnPageSec, scrollDepthPct) {
      await init();
      await sql`UPDATE visitor_touchpoints SET lead_id=${leadId}, converted=1, time_on_page_sec=COALESCE(${timeOnPageSec ?? null},time_on_page_sec), scroll_depth_pct=COALESCE(${scrollDepthPct ?? null},scroll_depth_pct) WHERE visitor_id=${visitorId} AND account_id=${accountId} AND (lead_id IS NULL OR lead_id=visitor_id)`;
    },
    async createAccount(accountId, name, domain) {
      await init();
      await sql`INSERT INTO accounts (account_id, name, domain) VALUES (${accountId},${name},${domain}) ON CONFLICT DO NOTHING`;
    },
    async listAccounts() {
      await init();
      const rows = await sql`SELECT account_id, name, domain, created_at FROM accounts ORDER BY created_at DESC`;
      return rows.map(r => ({ ...r, created_at: toISO(r.created_at) })) as AccountRow[];
    },
    async getRecentSessions(accountId, limit) {
      await init();
      const rows = await sql`SELECT visitor_id, ch_type, ch_source, ch_campaign, landing_url, lead_id, created_at FROM visitor_touchpoints WHERE account_id=${accountId} ORDER BY created_at DESC LIMIT ${limit}`;
      return rows.map(r => ({ ...r, created_at: toISO(r.created_at) })) as SessionEntry[];
    },
    async getJourneyByLead(leadId, accountId) {
      await init();
      const rows = await sql`SELECT * FROM visitor_touchpoints WHERE lead_id=${leadId} AND account_id=${accountId} ORDER BY session_num ASC`;
      return rows.map(r => ({ ...r, created_at: toISO(r.created_at) })) as TouchpointEntry[];
    },
    async getChannelReport(accountId) {
      await init();
      const rows = await sql`SELECT ch_type, COUNT(DISTINCT lead_id)::int as leads, SUM(CASE WHEN converted=1 THEN 1 ELSE 0 END)::int as conversions FROM visitor_touchpoints WHERE account_id=${accountId} AND lead_id IS NOT NULL GROUP BY ch_type ORDER BY conversions DESC`;
      return rows as unknown as ChannelRow[];
    },
    async getTopPaths(accountId) {
      await init();
      const rows = await sql`SELECT lead_id, string_agg(ch_type, ' → ' ORDER BY session_num) as path FROM visitor_touchpoints WHERE account_id=${accountId} AND lead_id IS NOT NULL GROUP BY lead_id`;
      return rows as unknown as PathRow[];
    },
    async getChannelPerformance(accountId) {
      await init();
      const rows = await sql`SELECT ch_type, COUNT(DISTINCT visitor_id)::int as visitors, COUNT(DISTINCT lead_id)::int as leads, SUM(CASE WHEN converted=1 THEN 1 ELSE 0 END)::int as conversions FROM visitor_touchpoints WHERE account_id=${accountId} GROUP BY ch_type ORDER BY visitors DESC`;
      return rows as unknown as PerformanceRow[];
    },
    async listLeads(accountId, limit) {
      await init();
      const rows = await sql`SELECT lead_id, ch_type, MAX(created_at) as created_at FROM visitor_touchpoints WHERE account_id=${accountId} AND lead_id IS NOT NULL GROUP BY lead_id, ch_type ORDER BY MAX(created_at) DESC LIMIT ${limit}`;
      return rows.map(r => ({ ...r, created_at: toISO(r.created_at) })) as LeadRow[];
    },
  };
}

// ── Singleton export ───────────────────────────────────────────────────────────

export function createDB(dbPath = "./trail.db"): TrailDB {
  const url = process.env.DATABASE_URL;
  if (url) {
    try { new URL(url); } catch {
      console.error("[db] DATABASE_URL invalid (empty host?), falling back to SQLite");
      return createSQLiteDB(dbPath);
    }
    return createPostgresDB(url);
  }
  return createSQLiteDB(dbPath);
}

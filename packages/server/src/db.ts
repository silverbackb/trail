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
  ch_term: string | null; ch_type: string; gclid: string | null; gbraid: string | null; wbraid: string | null; fbclid: string | null;
  landing_url: string | null; referrer: string | null; hostname: string | null;
}

export interface JourneyEntry {
  session_num: number; ch_type: string | null; ch_source: string | null;
  ch_medium: string | null; ch_campaign: string | null; ch_term: string | null;
  gclid: string | null; gbraid: string | null; wbraid: string | null; fbclid: string | null; landing_url: string | null;
  referrer: string | null; hostname: string | null;
  time_on_page_sec: number | null; scroll_depth_pct: number | null;
  created_at: string;
}

export interface AccountRow { account_id: string; name: string; domain: string; workspace_id: string | null; created_at: string; }
export interface SessionEntry { visitor_id: string; ch_type: string | null; ch_source: string | null; ch_campaign: string | null; landing_url: string | null; lead_id: string | null; created_at: string; }
export interface TouchpointEntry extends Record<string, unknown> { session_num: number; ch_type: string | null; ch_source: string | null; ch_campaign: string | null; landing_url: string | null; created_at: string; }
export interface ChannelRow { ch_type: string; leads: number; conversions: number; }
export interface PathRow { lead_id: string; path: string; }
export interface PerformanceRow { ch_type: string; visitors: number; leads: number; conversions: number; }
export interface LeadRow { lead_id: string; ch_type: string; created_at: string; }

export interface TrailDB {
  // maintenance
  purgeOldTouchpoints(olderThanDays: number): Promise<{ removed: number }>;
  // api.ts
  getRecentLogs(limit: number, workspaceId?: string | null): Promise<RecentLog[]>;
  getAccountsSummary(workspaceId?: string | null): Promise<AccountSummary[]>;
  sessionExists(visitorId: string, sessionHash: string): Promise<boolean>;
  countVisitorTouchpoints(visitorId: string, accountId: string): Promise<number>;
  insertTouchpoint(data: TouchpointInsert): Promise<void>;
  upsertSession(visitorId: string, accountId: string, sessionHash: string): Promise<void>;
  getJourneyByVisitor(visitorId: string, accountId?: string): Promise<JourneyEntry[]>;
  convertVisitor(leadId: string, visitorId: string, accountId: string, timeOnPageSec?: number, scrollDepthPct?: number): Promise<void>;
  getAccountWorkspaceId(accountId: string): Promise<string | null>;
  getMonthlySessionCount(workspaceId: string, month: string): Promise<number>;
  incrementMonthlySessionCount(workspaceId: string, month: string): Promise<void>;
  // mcp.ts
  createAccount(accountId: string, name: string, domain: string, workspaceId?: string | null): Promise<void>;
  listAccounts(workspaceId?: string | null): Promise<AccountRow[]>;
  getRecentSessions(accountId: string, limit: number): Promise<SessionEntry[]>;
  getJourneyByLead(leadId: string, accountId: string): Promise<TouchpointEntry[]>;
  getChannelReport(accountId: string): Promise<ChannelRow[]>;
  getTopPaths(accountId: string): Promise<PathRow[]>;
  getChannelPerformance(accountId: string): Promise<PerformanceRow[]>;
  listLeads(accountId: string, limit: number): Promise<LeadRow[]>;
  checkAccountAccess(accountId: string, workspaceId?: string | null): Promise<boolean>;
  deleteAccount(accountId: string, workspaceId?: string | null, force?: boolean): Promise<{ deleted: boolean; reason?: string; visitors: number; leads: number }>;
  deleteVisitor(accountId: string, visitorId: string, workspaceId?: string | null): Promise<{ deleted: boolean; reason?: string; touchpoints_removed: number }>;
  deleteLead(accountId: string, leadId: string, workspaceId?: string | null): Promise<{ deleted: boolean; reason?: string; touchpoints_updated: number }>;
  purgeAccountData(accountId: string, workspaceId?: string | null): Promise<{ purged: boolean; reason?: string; visitors_removed: number; leads_removed: number }>;
}

// ── SQLite ────────────────────────────────────────────────────────────────────

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS accounts (
    account_id  TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    domain      TEXT NOT NULL,
    workspace_id TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS workspace_monthly_usage (
    workspace_id  TEXT NOT NULL,
    month         TEXT NOT NULL,
    session_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_id, month)
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
    gbraid       TEXT,
    wbraid       TEXT,
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
  try { sqlite.exec("ALTER TABLE accounts ADD COLUMN workspace_id TEXT"); } catch {}
  try { sqlite.exec("ALTER TABLE visitor_touchpoints ADD COLUMN gbraid TEXT"); } catch {}
  try { sqlite.exec("ALTER TABLE visitor_touchpoints ADD COLUMN wbraid TEXT"); } catch {}

  const s = <T>(sql: string) => sqlite.prepare(sql) as unknown as { all: (...a: unknown[]) => T[]; get: (...a: unknown[]) => T | undefined; run: (...a: unknown[]) => void };

  return {
    async getRecentLogs(limit, workspaceId) {
      if (workspaceId) {
        s(`UPDATE accounts SET workspace_id = ? WHERE workspace_id IS NULL`).run(workspaceId);
        return s<RecentLog>(`
          SELECT t.id, t.account_id, t.visitor_id, t.ch_type, t.ch_source, t.ch_campaign,
                 t.landing_url, t.lead_id, t.converted, t.hostname, t.created_at, a.domain
          FROM visitor_touchpoints t
          LEFT JOIN accounts a ON a.account_id = t.account_id
          WHERE a.workspace_id = ?
          ORDER BY t.created_at DESC LIMIT ?
        `).all(workspaceId, limit);
      }
      return s<RecentLog>(`
        SELECT t.id, t.account_id, t.visitor_id, t.ch_type, t.ch_source, t.ch_campaign,
               t.landing_url, t.lead_id, t.converted, t.hostname, t.created_at, a.domain
        FROM visitor_touchpoints t
        LEFT JOIN accounts a ON a.account_id = t.account_id
        ORDER BY t.created_at DESC LIMIT ?
      `).all(limit);
    },
    async getAccountsSummary(workspaceId) {
      if (workspaceId) {
        s(`UPDATE accounts SET workspace_id = ? WHERE workspace_id IS NULL`).run(workspaceId);
        return s<AccountSummary>(`
          SELECT a.account_id, a.name, a.domain,
            COUNT(DISTINCT t.visitor_id) AS visitors,
            COUNT(DISTINCT t.lead_id)   AS leads,
            MAX(t.created_at)           AS last_touch
          FROM accounts a
          LEFT JOIN visitor_touchpoints t ON t.account_id = a.account_id
          WHERE a.workspace_id = ?
          GROUP BY a.account_id ORDER BY last_touch DESC
        `).all(workspaceId);
      }
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
      s(`INSERT INTO visitor_touchpoints (id,visitor_id,account_id,session_num,ch_source,ch_medium,ch_campaign,ch_term,ch_type,gclid,gbraid,wbraid,fbclid,landing_url,referrer,hostname) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(d.id, d.visitor_id, d.account_id, d.session_num, d.ch_source, d.ch_medium, d.ch_campaign, d.ch_term, d.ch_type, d.gclid, d.gbraid, d.wbraid, d.fbclid, d.landing_url, d.referrer, d.hostname);
    },
    async upsertSession(visitorId, accountId, sessionHash) {
      s(`INSERT OR IGNORE INTO visitor_sessions (visitor_id,account_id,session_hash) VALUES (?,?,?)`).run(visitorId, accountId, sessionHash);
    },
    async getJourneyByVisitor(visitorId, accountId) {
      const sql = accountId
        ? `SELECT session_num,ch_type,ch_source,ch_medium,ch_campaign,ch_term,gclid,gbraid,wbraid,fbclid,landing_url,referrer,hostname,time_on_page_sec,scroll_depth_pct,created_at FROM visitor_touchpoints WHERE visitor_id=? AND account_id=? ORDER BY session_num ASC`
        : `SELECT session_num,ch_type,ch_source,ch_medium,ch_campaign,ch_term,gclid,gbraid,wbraid,fbclid,landing_url,referrer,hostname,time_on_page_sec,scroll_depth_pct,created_at FROM visitor_touchpoints WHERE visitor_id=? ORDER BY session_num ASC`;
      return accountId ? s<JourneyEntry>(sql).all(visitorId, accountId) : s<JourneyEntry>(sql).all(visitorId);
    },
    async convertVisitor(leadId, visitorId, accountId, timeOnPageSec, scrollDepthPct) {
      s(`UPDATE visitor_touchpoints SET lead_id=?, converted=1, time_on_page_sec=COALESCE(?,time_on_page_sec), scroll_depth_pct=COALESCE(?,scroll_depth_pct) WHERE visitor_id=? AND account_id=? AND (lead_id IS NULL OR lead_id=visitor_id)`).run(leadId, timeOnPageSec ?? null, scrollDepthPct ?? null, visitorId, accountId);
    },
    async createAccount(accountId, name, domain, workspaceId) {
      s(`INSERT OR IGNORE INTO accounts (account_id, name, domain, workspace_id) VALUES (?, ?, ?, ?)`).run(accountId, name, domain, workspaceId ?? null);
    },
    async listAccounts(workspaceId) {
      if (workspaceId) {
        s(`UPDATE accounts SET workspace_id = ? WHERE workspace_id IS NULL`).run(workspaceId);
        return s<AccountRow>(`SELECT account_id, name, domain, workspace_id, created_at FROM accounts WHERE workspace_id = ? ORDER BY created_at DESC`).all(workspaceId);
      }
      return s<AccountRow>(`SELECT account_id, name, domain, workspace_id, created_at FROM accounts ORDER BY created_at DESC`).all();
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
    async checkAccountAccess(accountId, workspaceId) {
      if (!workspaceId) return true;
      s(`UPDATE accounts SET workspace_id = ? WHERE account_id = ? AND workspace_id IS NULL`).run(workspaceId, accountId);
      const row = s<{ 1: number }>(`SELECT 1 FROM accounts WHERE account_id = ? AND workspace_id = ?`).get(accountId, workspaceId);
      return !!row;
    },
    async deleteAccount(accountId, workspaceId, force = false) {
      if (workspaceId) {
        const row = s<{ 1: number }>(`SELECT 1 FROM accounts WHERE account_id = ? AND workspace_id = ?`).get(accountId, workspaceId);
        if (!row) return { deleted: false, reason: "not_found", visitors: 0, leads: 0 };
      }
      const visitors = s<{ n: number }>(`SELECT COUNT(DISTINCT visitor_id) as n FROM visitor_touchpoints WHERE account_id=?`).get(accountId)?.n ?? 0;
      const leads = s<{ n: number }>(`SELECT COUNT(DISTINCT lead_id) as n FROM visitor_touchpoints WHERE account_id=? AND lead_id IS NOT NULL`).get(accountId)?.n ?? 0;
      if (!force && (visitors > 0 || leads > 0)) {
        return { deleted: false, reason: "has_data", visitors, leads };
      }
      s(`DELETE FROM visitor_sessions WHERE account_id=?`).run(accountId);
      s(`DELETE FROM visitor_touchpoints WHERE account_id=?`).run(accountId);
      s(`DELETE FROM accounts WHERE account_id=?`).run(accountId);
      return { deleted: true, visitors, leads };
    },
    async deleteVisitor(accountId, visitorId, workspaceId) {
      if (workspaceId) {
        const row = s<{ 1: number }>(`SELECT 1 FROM accounts WHERE account_id = ? AND workspace_id = ?`).get(accountId, workspaceId);
        if (!row) return { deleted: false, reason: "not_found", touchpoints_removed: 0 };
      }
      const n = s<{ n: number }>(`SELECT COUNT(*) as n FROM visitor_touchpoints WHERE account_id=? AND visitor_id=?`).get(accountId, visitorId)?.n ?? 0;
      s(`DELETE FROM visitor_sessions WHERE account_id=? AND visitor_id=?`).run(accountId, visitorId);
      s(`DELETE FROM visitor_touchpoints WHERE account_id=? AND visitor_id=?`).run(accountId, visitorId);
      return { deleted: true, touchpoints_removed: n };
    },
    async deleteLead(accountId, leadId, workspaceId) {
      if (workspaceId) {
        const row = s<{ 1: number }>(`SELECT 1 FROM accounts WHERE account_id = ? AND workspace_id = ?`).get(accountId, workspaceId);
        if (!row) return { deleted: false, reason: "not_found", touchpoints_updated: 0 };
      }
      const n = s<{ n: number }>(`SELECT COUNT(*) as n FROM visitor_touchpoints WHERE account_id=? AND lead_id=?`).get(accountId, leadId)?.n ?? 0;
      s(`UPDATE visitor_touchpoints SET lead_id=NULL, converted=0 WHERE account_id=? AND lead_id=?`).run(accountId, leadId);
      return { deleted: true, touchpoints_updated: n };
    },
    async purgeAccountData(accountId, workspaceId) {
      if (workspaceId) {
        const row = s<{ 1: number }>(`SELECT 1 FROM accounts WHERE account_id = ? AND workspace_id = ?`).get(accountId, workspaceId);
        if (!row) return { purged: false, reason: "not_found", visitors_removed: 0, leads_removed: 0 };
      }
      const visitors = s<{ n: number }>(`SELECT COUNT(DISTINCT visitor_id) as n FROM visitor_touchpoints WHERE account_id=?`).get(accountId)?.n ?? 0;
      const leads = s<{ n: number }>(`SELECT COUNT(DISTINCT lead_id) as n FROM visitor_touchpoints WHERE account_id=? AND lead_id IS NOT NULL`).get(accountId)?.n ?? 0;
      s(`DELETE FROM visitor_sessions WHERE account_id=?`).run(accountId);
      s(`DELETE FROM visitor_touchpoints WHERE account_id=?`).run(accountId);
      return { purged: true, visitors_removed: visitors, leads_removed: leads };
    },
    async purgeOldTouchpoints(olderThanDays) {
      const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
      const before = s<{ n: number }>(`SELECT COUNT(*) as n FROM visitor_touchpoints WHERE created_at < ?`).get(cutoff)?.n ?? 0;
      s(`DELETE FROM visitor_sessions WHERE visitor_id IN (SELECT DISTINCT visitor_id FROM visitor_touchpoints WHERE created_at < ?) AND visitor_id NOT IN (SELECT DISTINCT visitor_id FROM visitor_touchpoints WHERE created_at >= ?)`).run(cutoff, cutoff);
      s(`DELETE FROM visitor_touchpoints WHERE created_at < ?`).run(cutoff);
      return { removed: before };
    },
    async getAccountWorkspaceId(accountId) {
      const row = s<{ workspace_id: string | null }>(`SELECT workspace_id FROM accounts WHERE account_id = ?`).get(accountId);
      return row?.workspace_id ?? null;
    },
    async getMonthlySessionCount(workspaceId, month) {
      const row = s<{ n: number }>(`SELECT session_count as n FROM workspace_monthly_usage WHERE workspace_id = ? AND month = ?`).get(workspaceId, month);
      return row?.n ?? 0;
    },
    async incrementMonthlySessionCount(workspaceId, month) {
      s(`INSERT INTO workspace_monthly_usage (workspace_id, month, session_count) VALUES (?, ?, 1) ON CONFLICT (workspace_id, month) DO UPDATE SET session_count = session_count + 1`).run(workspaceId, month);
    },
  };
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────

const CREATE_TABLES_PG = `
  CREATE TABLE IF NOT EXISTS accounts (
    account_id  TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    domain      TEXT NOT NULL,
    workspace_id TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS workspace_monthly_usage (
    workspace_id  TEXT NOT NULL,
    month         TEXT NOT NULL,
    session_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_id, month)
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
    gbraid       TEXT,
    wbraid       TEXT,
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
    await sql.unsafe("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS workspace_id TEXT");
    await sql.unsafe("ALTER TABLE visitor_touchpoints ADD COLUMN IF NOT EXISTS gbraid TEXT");
    await sql.unsafe("ALTER TABLE visitor_touchpoints ADD COLUMN IF NOT EXISTS wbraid TEXT");
    initialized = true;
  }

  return {
    async getRecentLogs(limit, workspaceId) {
      await init();
      if (workspaceId) {
        await sql`UPDATE accounts SET workspace_id = ${workspaceId} WHERE workspace_id IS NULL`;
      }
      const rows = workspaceId
        ? await sql`
            SELECT t.id, t.account_id, t.visitor_id, t.ch_type, t.ch_source, t.ch_campaign,
                   t.landing_url, t.lead_id, t.converted, t.hostname, t.created_at, a.domain
            FROM visitor_touchpoints t
            LEFT JOIN accounts a ON a.account_id = t.account_id
            WHERE a.workspace_id = ${workspaceId}
            ORDER BY t.created_at DESC LIMIT ${limit}
          `
        : await sql`
            SELECT t.id, t.account_id, t.visitor_id, t.ch_type, t.ch_source, t.ch_campaign,
                   t.landing_url, t.lead_id, t.converted, t.hostname, t.created_at, a.domain
            FROM visitor_touchpoints t
            LEFT JOIN accounts a ON a.account_id = t.account_id
            ORDER BY t.created_at DESC LIMIT ${limit}
          `;
      return rows.map(r => ({ ...r, created_at: toISO(r.created_at) })) as RecentLog[];
    },
    async getAccountsSummary(workspaceId) {
      await init();
      if (workspaceId) {
        await sql`UPDATE accounts SET workspace_id = ${workspaceId} WHERE workspace_id IS NULL`;
      }
      const rows = workspaceId
        ? await sql`
            SELECT a.account_id, a.name, a.domain,
              COUNT(DISTINCT t.visitor_id)::int AS visitors,
              COUNT(DISTINCT t.lead_id)::int    AS leads,
              MAX(t.created_at)                 AS last_touch
            FROM accounts a
            LEFT JOIN visitor_touchpoints t ON t.account_id = a.account_id
            WHERE a.workspace_id = ${workspaceId}
            GROUP BY a.account_id ORDER BY last_touch DESC
          `
        : await sql`
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
        INSERT INTO visitor_touchpoints (id,visitor_id,account_id,session_num,ch_source,ch_medium,ch_campaign,ch_term,ch_type,gclid,gbraid,wbraid,fbclid,landing_url,referrer,hostname)
        VALUES (${d.id},${d.visitor_id},${d.account_id},${d.session_num},${d.ch_source},${d.ch_medium},${d.ch_campaign},${d.ch_term},${d.ch_type},${d.gclid},${d.gbraid},${d.wbraid},${d.fbclid},${d.landing_url},${d.referrer},${d.hostname})
      `;
    },
    async upsertSession(visitorId, accountId, sessionHash) {
      await init();
      await sql`INSERT INTO visitor_sessions (visitor_id,account_id,session_hash) VALUES (${visitorId},${accountId},${sessionHash}) ON CONFLICT DO NOTHING`;
    },
    async getJourneyByVisitor(visitorId, accountId) {
      await init();
      const rows = accountId
        ? await sql`SELECT session_num,ch_type,ch_source,ch_medium,ch_campaign,ch_term,gclid,gbraid,wbraid,fbclid,landing_url,referrer,hostname,time_on_page_sec,scroll_depth_pct,created_at FROM visitor_touchpoints WHERE visitor_id=${visitorId} AND account_id=${accountId} ORDER BY session_num ASC`
        : await sql`SELECT session_num,ch_type,ch_source,ch_medium,ch_campaign,ch_term,gclid,gbraid,wbraid,fbclid,landing_url,referrer,hostname,time_on_page_sec,scroll_depth_pct,created_at FROM visitor_touchpoints WHERE visitor_id=${visitorId} ORDER BY session_num ASC`;
      return rows.map(r => ({ ...r, created_at: toISO(r.created_at) })) as JourneyEntry[];
    },
    async convertVisitor(leadId, visitorId, accountId, timeOnPageSec, scrollDepthPct) {
      await init();
      await sql`UPDATE visitor_touchpoints SET lead_id=${leadId}, converted=1, time_on_page_sec=COALESCE(${timeOnPageSec ?? null},time_on_page_sec), scroll_depth_pct=COALESCE(${scrollDepthPct ?? null},scroll_depth_pct) WHERE visitor_id=${visitorId} AND account_id=${accountId} AND (lead_id IS NULL OR lead_id=visitor_id)`;
    },
    async createAccount(accountId, name, domain, workspaceId) {
      await init();
      await sql`INSERT INTO accounts (account_id, name, domain, workspace_id) VALUES (${accountId},${name},${domain},${workspaceId ?? null}) ON CONFLICT DO NOTHING`;
    },
    async listAccounts(workspaceId) {
      await init();
      if (workspaceId) {
        await sql`UPDATE accounts SET workspace_id = ${workspaceId} WHERE workspace_id IS NULL`;
      }
      const rows = workspaceId
        ? await sql`SELECT account_id, name, domain, workspace_id, created_at FROM accounts WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC`
        : await sql`SELECT account_id, name, domain, workspace_id, created_at FROM accounts ORDER BY created_at DESC`;
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
    async checkAccountAccess(accountId, workspaceId) {
      if (!workspaceId) return true;
      await init();
      await sql`UPDATE accounts SET workspace_id = ${workspaceId} WHERE account_id = ${accountId} AND workspace_id IS NULL`;
      const rows = await sql`SELECT 1 FROM accounts WHERE account_id = ${accountId} AND workspace_id = ${workspaceId}`;
      return rows.length > 0;
    },
    async deleteAccount(accountId, workspaceId, force = false) {
      await init();
      if (workspaceId) {
        const rows = await sql`SELECT 1 FROM accounts WHERE account_id = ${accountId} AND workspace_id = ${workspaceId}`;
        if (!rows.length) return { deleted: false, reason: "not_found", visitors: 0, leads: 0 };
      }
      const [vcnt] = await sql`SELECT COUNT(DISTINCT visitor_id)::int as n FROM visitor_touchpoints WHERE account_id=${accountId}`;
      const [lcnt] = await sql`SELECT COUNT(DISTINCT lead_id)::int as n FROM visitor_touchpoints WHERE account_id=${accountId} AND lead_id IS NOT NULL`;
      const visitors = (vcnt as { n: number }).n ?? 0;
      const leads = (lcnt as { n: number }).n ?? 0;
      if (!force && (visitors > 0 || leads > 0)) {
        return { deleted: false, reason: "has_data", visitors, leads };
      }
      await sql`DELETE FROM visitor_sessions WHERE account_id=${accountId}`;
      await sql`DELETE FROM visitor_touchpoints WHERE account_id=${accountId}`;
      await sql`DELETE FROM accounts WHERE account_id=${accountId}`;
      return { deleted: true, visitors, leads };
    },
    async deleteVisitor(accountId, visitorId, workspaceId) {
      await init();
      if (workspaceId) {
        const rows = await sql`SELECT 1 FROM accounts WHERE account_id = ${accountId} AND workspace_id = ${workspaceId}`;
        if (!rows.length) return { deleted: false, reason: "not_found", touchpoints_removed: 0 };
      }
      const [cnt] = await sql`SELECT COUNT(*)::int as n FROM visitor_touchpoints WHERE account_id=${accountId} AND visitor_id=${visitorId}`;
      const n = (cnt as { n: number }).n ?? 0;
      await sql`DELETE FROM visitor_sessions WHERE account_id=${accountId} AND visitor_id=${visitorId}`;
      await sql`DELETE FROM visitor_touchpoints WHERE account_id=${accountId} AND visitor_id=${visitorId}`;
      return { deleted: true, touchpoints_removed: n };
    },
    async deleteLead(accountId, leadId, workspaceId) {
      await init();
      if (workspaceId) {
        const rows = await sql`SELECT 1 FROM accounts WHERE account_id = ${accountId} AND workspace_id = ${workspaceId}`;
        if (!rows.length) return { deleted: false, reason: "not_found", touchpoints_updated: 0 };
      }
      const [cnt] = await sql`SELECT COUNT(*)::int as n FROM visitor_touchpoints WHERE account_id=${accountId} AND lead_id=${leadId}`;
      const n = (cnt as { n: number }).n ?? 0;
      await sql`UPDATE visitor_touchpoints SET lead_id=NULL, converted=0 WHERE account_id=${accountId} AND lead_id=${leadId}`;
      return { deleted: true, touchpoints_updated: n };
    },
    async purgeAccountData(accountId, workspaceId) {
      await init();
      if (workspaceId) {
        const rows = await sql`SELECT 1 FROM accounts WHERE account_id = ${accountId} AND workspace_id = ${workspaceId}`;
        if (!rows.length) return { purged: false, reason: "not_found", visitors_removed: 0, leads_removed: 0 };
      }
      const [vcnt] = await sql`SELECT COUNT(DISTINCT visitor_id)::int as n FROM visitor_touchpoints WHERE account_id=${accountId}`;
      const [lcnt] = await sql`SELECT COUNT(DISTINCT lead_id)::int as n FROM visitor_touchpoints WHERE account_id=${accountId} AND lead_id IS NOT NULL`;
      const visitors_removed = (vcnt as { n: number }).n ?? 0;
      const leads_removed = (lcnt as { n: number }).n ?? 0;
      await sql`DELETE FROM visitor_sessions WHERE account_id=${accountId}`;
      await sql`DELETE FROM visitor_touchpoints WHERE account_id=${accountId}`;
      return { purged: true, visitors_removed, leads_removed };
    },
    async purgeOldTouchpoints(olderThanDays) {
      await init();
      const cutoff = new Date(Date.now() - olderThanDays * 86400_000);
      await sql`
        DELETE FROM visitor_sessions
        WHERE visitor_id IN (SELECT DISTINCT visitor_id FROM visitor_touchpoints WHERE created_at < ${cutoff})
        AND visitor_id NOT IN (SELECT DISTINCT visitor_id FROM visitor_touchpoints WHERE created_at >= ${cutoff})
      `;
      const [row] = await sql`SELECT COUNT(*)::int as n FROM visitor_touchpoints WHERE created_at < ${cutoff}`;
      await sql`DELETE FROM visitor_touchpoints WHERE created_at < ${cutoff}`;
      return { removed: (row as { n: number }).n ?? 0 };
    },
    async getAccountWorkspaceId(accountId) {
      await init();
      const rows = await sql`SELECT workspace_id FROM accounts WHERE account_id = ${accountId}`;
      return (rows[0] as { workspace_id: string | null } | undefined)?.workspace_id ?? null;
    },
    async getMonthlySessionCount(workspaceId, month) {
      await init();
      const rows = await sql`SELECT session_count as n FROM workspace_monthly_usage WHERE workspace_id = ${workspaceId} AND month = ${month}`;
      return ((rows[0] as { n: number } | undefined)?.n ?? 0) as number;
    },
    async incrementMonthlySessionCount(workspaceId, month) {
      await init();
      await sql`INSERT INTO workspace_monthly_usage (workspace_id, month, session_count) VALUES (${workspaceId}, ${month}, 1) ON CONFLICT (workspace_id, month) DO UPDATE SET session_count = workspace_monthly_usage.session_count + 1`;
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

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";

export async function maybeMigrateSQLiteToPG(dbPath: string, pgUrl: string): Promise<void> {
  if (!existsSync(dbPath)) return;

  const sql = postgres(pgUrl);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL,
      workspace_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS visitor_touchpoints (
      id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, account_id TEXT NOT NULL,
      lead_id TEXT, session_num INTEGER NOT NULL, ch_source TEXT, ch_medium TEXT,
      ch_campaign TEXT, ch_term TEXT, ch_type TEXT, gclid TEXT, fbclid TEXT,
      landing_url TEXT, referrer TEXT, hostname TEXT,
      converted INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS visitor_sessions (
      visitor_id TEXT NOT NULL, account_id TEXT NOT NULL, session_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(visitor_id, session_hash)
    );
  `);

  // Check if PG already has data — if so, skip
  const [{ n }] = await sql`SELECT COUNT(*)::int as n FROM accounts` as [{ n: number }];
  if (n > 0) {
    await sql.end();
    return;
  }

  const sqlite = new DatabaseSync(dbPath);
  const accounts    = sqlite.prepare("SELECT * FROM accounts").all()             as Record<string, unknown>[];
  const touchpoints = sqlite.prepare("SELECT * FROM visitor_touchpoints").all()  as Record<string, unknown>[];
  const sessions    = sqlite.prepare("SELECT * FROM visitor_sessions").all()     as Record<string, unknown>[];

  if (!accounts.length && !touchpoints.length) {
    await sql.end();
    return;
  }

  console.log(`[migrate] SQLite → PG: ${accounts.length} accounts, ${touchpoints.length} touchpoints, ${sessions.length} sessions`);

  for (const r of accounts) {
    await sql`
      INSERT INTO accounts (account_id, name, domain, workspace_id, created_at)
      VALUES (${r.account_id as string}, ${r.name as string}, ${r.domain as string}, ${r.workspace_id as string | null ?? null}, ${r.created_at as string})
      ON CONFLICT DO NOTHING
    `;
  }

  for (const r of touchpoints) {
    await sql`
      INSERT INTO visitor_touchpoints
        (id,visitor_id,account_id,lead_id,session_num,ch_source,ch_medium,ch_campaign,ch_term,ch_type,gclid,fbclid,landing_url,referrer,hostname,converted,created_at)
      VALUES
        (${r.id as string},${r.visitor_id as string},${r.account_id as string},${r.lead_id as string | null},
         ${r.session_num as number},${r.ch_source as string | null},${r.ch_medium as string | null},
         ${r.ch_campaign as string | null},${r.ch_term as string | null},${r.ch_type as string | null},
         ${r.gclid as string | null},${r.fbclid as string | null},${r.landing_url as string | null},
         ${r.referrer as string | null},${r.hostname as string | null},${r.converted as number},${r.created_at as string})
      ON CONFLICT DO NOTHING
    `;
  }

  for (const r of sessions) {
    await sql`
      INSERT INTO visitor_sessions (visitor_id, account_id, session_hash, created_at)
      VALUES (${r.visitor_id as string}, ${r.account_id as string}, ${r.session_hash as string}, ${r.created_at as string})
      ON CONFLICT DO NOTHING
    `;
  }

  await sql.end();
  console.log("[migrate] Done.");
}

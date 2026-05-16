import { Hono } from "hono";
import { cors } from "hono/cors";
import { ConvertSchema, TouchpointSchema } from "./schema.js";

export interface Env {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

// POST /t — receive touchpoint from tracker script
app.post("/t", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = TouchpointSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid" }, 400);

  const { visitor_id, account_id, channel, hostname } = parsed.data;
  const db = c.env.DB;

  // Deduplicate: one touchpoint per visitor+source combo per day
  const sessionHash = btoa(`${visitor_id}:${channel.referrer_type}:${channel.utm_source ?? ""}:${new Date().toISOString().slice(0, 10)}`);

  const exists = await db
    .prepare("SELECT 1 FROM visitor_sessions WHERE visitor_id=? AND session_hash=?")
    .bind(visitor_id, sessionHash)
    .first();

  if (exists) return c.json({ ok: true, duplicate: true });

  // Get session number
  const countRow = await db
    .prepare("SELECT COUNT(*) as n FROM visitor_touchpoints WHERE visitor_id=? AND account_id=?")
    .bind(visitor_id, account_id)
    .first<{ n: number }>();
  const sessionNum = (countRow?.n ?? 0) + 1;

  const id = crypto.randomUUID();

  await db.batch([
    db.prepare(
      `INSERT INTO visitor_touchpoints
        (id,visitor_id,account_id,session_num,ch_source,ch_medium,ch_campaign,ch_term,ch_type,gclid,fbclid,landing_url,referrer,hostname)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, visitor_id, account_id, sessionNum,
      channel.utm_source, channel.utm_medium, channel.utm_campaign, channel.utm_term,
      channel.referrer_type, channel.gclid, channel.fbclid,
      channel.landing_url, channel.referrer, hostname
    ),
    db.prepare(
      "INSERT OR IGNORE INTO visitor_sessions (visitor_id,account_id,session_hash) VALUES (?,?,?)"
    ).bind(visitor_id, account_id, sessionHash),
  ]);

  return c.json({ ok: true, session: sessionNum });
});

// POST /convert — link visitor to lead on form submit (Phase 1: form = conversion)
app.post("/convert", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ConvertSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid" }, 400);

  const { visitor_id, account_id, lead_id } = parsed.data;

  await c.env.DB
    .prepare("UPDATE visitor_touchpoints SET lead_id=?, converted=1 WHERE visitor_id=? AND account_id=? AND lead_id IS NULL")
    .bind(lead_id, visitor_id, account_id)
    .run();

  return c.json({ ok: true });
});

// GET /journey/:lead_id — touchpoint journey for a lead
app.get("/journey/:lead_id", async (c) => {
  const { lead_id } = c.req.param();
  const account_id = c.req.query("account_id");
  if (!account_id) return c.json({ error: "account_id required" }, 400);

  const rows = await c.env.DB
    .prepare("SELECT * FROM visitor_touchpoints WHERE lead_id=? AND account_id=? ORDER BY session_num ASC")
    .bind(lead_id, account_id)
    .all();

  return c.json({ journey: rows.results });
});

// GET /report — attribution report by model
app.get("/report", async (c) => {
  const account_id = c.req.query("account_id");
  const model = c.req.query("model") ?? "last_touch";
  if (!account_id) return c.json({ error: "account_id required" }, 400);

  // Get all converted touchpoints grouped by channel
  const rows = await c.env.DB
    .prepare(`
      SELECT ch_type, COUNT(DISTINCT lead_id) as leads, SUM(converted) as conversions
      FROM visitor_touchpoints
      WHERE account_id=? AND lead_id IS NOT NULL
      GROUP BY ch_type
      ORDER BY conversions DESC
    `)
    .bind(account_id)
    .all();

  return c.json({ model, channels: rows.results });
});

// GET /top-paths — most common conversion paths
app.get("/top-paths", async (c) => {
  const account_id = c.req.query("account_id");
  if (!account_id) return c.json({ error: "account_id required" }, 400);

  const rows = await c.env.DB
    .prepare(`
      SELECT lead_id, GROUP_CONCAT(ch_type, ' → ') as path, COUNT(*) as steps
      FROM (
        SELECT lead_id, ch_type FROM visitor_touchpoints
        WHERE account_id=? AND lead_id IS NOT NULL
        ORDER BY lead_id, session_num
      )
      GROUP BY lead_id
    `)
    .bind(account_id)
    .all<{ lead_id: string; path: string; steps: number }>();

  // Count path frequency
  const freq: Record<string, number> = {};
  for (const row of rows.results) {
    freq[row.path] = (freq[row.path] ?? 0) + 1;
  }

  const paths = Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));

  return c.json({ paths });
});

export default app;

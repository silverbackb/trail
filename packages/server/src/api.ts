import { Hono } from "hono";
import { z } from "zod";
import type Database from "better-sqlite3";
import { TRACKER_SCRIPT } from "./tracker.js";

const TouchpointSchema = z.object({
  visitor_id: z.string(),
  account_id: z.string(),
  hostname: z.string().optional(),
  channel: z.object({
    utm_source: z.string().nullable().optional(),
    utm_medium: z.string().nullable().optional(),
    utm_campaign: z.string().nullable().optional(),
    utm_term: z.string().nullable().optional(),
    gclid: z.string().nullable().optional(),
    fbclid: z.string().nullable().optional(),
    referrer: z.string().nullable().optional(),
    referrer_type: z.string(),
    landing_url: z.string().optional(),
  }),
});

const ConvertSchema = z.object({
  visitor_id: z.string(),
  account_id: z.string(),
  lead_id: z.string(),
});

export function createApiRoutes(db: Database.Database) {
  const app = new Hono();

  app.get("/t.js", (c) => {
    return c.body(TRACKER_SCRIPT, 200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
  });

  app.post("/t", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = TouchpointSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid" }, 400);

    const { visitor_id, account_id, channel, hostname } = parsed.data;
    const sessionHash = Buffer.from(
      `${visitor_id}:${channel.referrer_type}:${channel.utm_source ?? ""}:${new Date().toISOString().slice(0, 10)}`
    ).toString("base64");

    const exists = db.prepare("SELECT 1 FROM visitor_sessions WHERE visitor_id=? AND session_hash=?")
      .get(visitor_id, sessionHash);

    if (exists) return c.json({ ok: true, duplicate: true });

    const countRow = db.prepare("SELECT COUNT(*) as n FROM visitor_touchpoints WHERE visitor_id=? AND account_id=?")
      .get(visitor_id, account_id) as { n: number };
    const sessionNum = (countRow?.n ?? 0) + 1;
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO visitor_touchpoints
        (id,visitor_id,account_id,session_num,ch_source,ch_medium,ch_campaign,ch_term,ch_type,gclid,fbclid,landing_url,referrer,hostname)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, visitor_id, account_id, sessionNum,
      channel.utm_source, channel.utm_medium, channel.utm_campaign, channel.utm_term,
      channel.referrer_type, channel.gclid, channel.fbclid,
      channel.landing_url, channel.referrer, hostname
    );

    db.prepare("INSERT OR IGNORE INTO visitor_sessions (visitor_id,account_id,session_hash) VALUES (?,?,?)")
      .run(visitor_id, account_id, sessionHash);

    return c.json({ ok: true, session: sessionNum });
  });

  app.post("/convert", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ConvertSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid" }, 400);

    const { visitor_id, account_id, lead_id } = parsed.data;
    db.prepare("UPDATE visitor_touchpoints SET lead_id=?, converted=1 WHERE visitor_id=? AND account_id=? AND lead_id IS NULL")
      .run(lead_id, visitor_id, account_id);

    return c.json({ ok: true });
  });

  return app;
}

import { Hono } from "hono";
import { z } from "zod";
import type { TrailDB } from "./db.js";
import { TRACKER_SCRIPT } from "./tracker.js";
import { requireAuth } from "./auth.js";

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
    li_fat_id: z.string().nullable().optional(),
    ttclid: z.string().nullable().optional(),
    referrer: z.string().nullable().optional(),
    referrer_type: z.string(),
    landing_url: z.string().optional(),
  }),
});

const ConvertSchema = z.object({
  visitor_id: z.string(),
  account_id: z.string(),
  lead_id: z.string(),
  time_on_page_sec: z.number().int().nonnegative().optional(),
  scroll_depth_pct: z.number().int().min(0).max(100).optional(),
});

export function createApiRoutes(db: TrailDB) {
  const app = new Hono();

  app.get("/t.js", (c) => {
    return c.body(TRACKER_SCRIPT, 200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    });
  });

  app.get("/logs/recent", requireAuth, async (c) => {
    const workspaceId = (c.get as any)("workspaceId") as string | null;
    const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 100);
    const rows = await db.getRecentLogs(limit, workspaceId);
    return c.json(rows.map((r) => ({
      ...r,
      created_at: new Date(r.created_at + (r.created_at.includes("T") ? "" : "Z")).toISOString(),
    })));
  });

  app.get("/accounts/summary", requireAuth, async (c) => {
    const workspaceId = (c.get as any)("workspaceId") as string | null;
    const rows = await db.getAccountsSummary(workspaceId);
    return c.json(rows.map((r) => ({
      ...r,
      last_touch: r.last_touch
        ? new Date(r.last_touch + (r.last_touch.includes("T") ? "" : "Z")).toISOString()
        : null,
    })));
  });

  app.post("/t", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = TouchpointSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid" }, 400);

    if (parsed.data.channel.landing_url?.includes("gtm-msr.appspot.com")) {
      return c.json({ ok: true, ignored: "gtm_preview" });
    }

    const { visitor_id, account_id, channel, hostname } = parsed.data;
    const sessionHash = Buffer.from(
      `${visitor_id}:${channel.referrer_type}:${channel.utm_source ?? ""}:${new Date().toISOString().slice(0, 10)}`
    ).toString("base64");

    if (await db.sessionExists(visitor_id, sessionHash)) {
      return c.json({ ok: true, duplicate: true });
    }

    const sessionNum = (await db.countVisitorTouchpoints(visitor_id, account_id)) + 1;

    await db.insertTouchpoint({
      id: crypto.randomUUID(),
      visitor_id, account_id, session_num: sessionNum,
      ch_source: channel.utm_source ?? null,
      ch_medium: channel.utm_medium ?? null,
      ch_campaign: channel.utm_campaign ?? null,
      ch_term: channel.utm_term ?? null,
      ch_type: channel.referrer_type,
      gclid: channel.gclid ?? null,
      fbclid: channel.fbclid ?? null,
      landing_url: channel.landing_url ?? null,
      referrer: channel.referrer ?? null,
      hostname: hostname ?? null,
    });

    await db.upsertSession(visitor_id, account_id, sessionHash);

    return c.json({ ok: true, session: sessionNum });
  });

  app.get("/journey/:visitor_id", requireAuth, async (c) => {
    const workspaceId = (c.get as any)("workspaceId") as string | null;
    const visitor_id = c.req.param("visitor_id");
    const account_id = c.req.query("account_id");

    if (account_id) {
      const hasAccess = await db.checkAccountAccess(account_id, workspaceId);
      if (!hasAccess) return c.json({ error: "Access denied" }, 403);
    }

    const rows = await db.getJourneyByVisitor(visitor_id, account_id);
    return c.json({ visitor_id, sessions: rows });
  });

  app.post("/convert", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ConvertSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid" }, 400);
    const { visitor_id, account_id, lead_id, time_on_page_sec, scroll_depth_pct } = parsed.data;
    await db.convertVisitor(lead_id, visitor_id, account_id, time_on_page_sec, scroll_depth_pct);
    return c.json({ ok: true });
  });

  return app;
}

#!/usr/bin/env node
if (process.argv.slice(2).includes("init")) {
  await import("./init.js");
} else {
  const { serve } = await import("@hono/node-server");
  const { Hono } = await import("hono");
  const { cors } = await import("hono/cors");
  const { createDB } = await import("./db.js");
  const { createApiRoutes } = await import("./api.js");
  const { createMcpHandler } = await import("./mcp.js");
  const { requireAuth } = await import("./auth.js");
  const { maybeMigrateSQLiteToPG } = await import("./migrate.js");
  const port = parseInt(process.env.PORT ?? "3000");
  const dbPath = process.env.DB_PATH ?? "./trail.db";
  const pgUrl = process.env.DATABASE_URL;

  if (pgUrl) {
    await maybeMigrateSQLiteToPG(dbPath, pgUrl).catch((e) => console.error("[migrate] failed:", e));
  }

  const db = createDB(dbPath);
  const app = new Hono();

  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));

  // Structured request logging — propagate x-trace-id from MCP gateway
  app.use("*", async (c, next) => {
    const start = Date.now();
    const traceId = c.req.header("x-trace-id") ?? "local";
    await next();
    process.stdout.write(JSON.stringify({
      service: "trail",
      trace_id: traceId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      duration_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    }) + "\n");
  });

  app.route("/", createApiRoutes(db));
  app.all("/mcp", requireAuth, createMcpHandler(db));

  serve({ fetch: app.fetch, port, hostname: "::" }, () => {
    const base = process.env.TRAIL_URL ?? `http://localhost:${port}`;
    console.log(`Trail server running on port ${port}`);
    console.log(`  MCP    → ${base}/mcp`);
    console.log(`  Tracker→ ${base}/t.js`);
    console.log(`  DB     → ${dbPath}`);
  });

  const retentionDays = parseInt(process.env.TRAIL_RETENTION_DAYS ?? "365");
  const runPurge = async () => {
    try {
      const { removed } = await db.purgeOldTouchpoints(retentionDays);
      if (removed > 0) console.log(JSON.stringify({ service: "trail", event: "purge", removed, retention_days: retentionDays, timestamp: new Date().toISOString() }));
    } catch (e) {
      console.error("[purge] failed:", e);
    }
  };
  await runPurge();
  setInterval(runPurge, 24 * 60 * 60 * 1000);
}

#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createDB } from "./db.js";
import { createApiRoutes } from "./api.js";
import { createMcpHandler } from "./mcp.js";
import { requireAuth } from "./auth.js";
import { maybeMigrateSQLiteToPG } from "./migrate.js";

if (process.argv.slice(2).includes("init")) {
  await import("./init.js");
} else {
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

  serve({ fetch: app.fetch, port }, () => {
    const base = process.env.TRAIL_URL ?? `http://localhost:${port}`;
    console.log(`Trail server running on port ${port}`);
    console.log(`  MCP    → ${base}/mcp`);
    console.log(`  Tracker→ ${base}/t.js`);
    console.log(`  DB     → ${dbPath}`);
  });
}

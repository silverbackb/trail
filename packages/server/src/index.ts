#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createDB } from "./db.js";
import { createApiRoutes } from "./api.js";
import { createMcpHandler } from "./mcp.js";

const port = parseInt(process.env.PORT ?? "3000");
const dbPath = process.env.DB_PATH ?? "./trail.db";

const db = createDB(dbPath);
const app = new Hono();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));
app.route("/", createApiRoutes(db));
app.all("/mcp", createMcpHandler(db));

serve({ fetch: app.fetch, port }, () => {
  const base = process.env.TRAIL_URL ?? `http://localhost:${port}`;
  console.log(`Trail server running on port ${port}`);
  console.log(`  MCP    → ${base}/mcp`);
  console.log(`  Tracker→ ${base}/t.js`);
  console.log(`  DB     → ${dbPath}`);
});

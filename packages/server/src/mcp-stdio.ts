#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDB } from "./db.js";
import { buildServer } from "./mcp.js";

const dbPath = process.env.DB_PATH ?? "./trail.db";
const db = createDB(dbPath);
const server = buildServer(db);

const transport = new StdioServerTransport();
await server.connect(transport);

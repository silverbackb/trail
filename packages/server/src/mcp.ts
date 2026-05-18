import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Context } from "hono";
import type { DatabaseSync } from "node:sqlite";

function toLocalTime(utc: string): string {
  const tz = process.env.TRAIL_TZ ?? "Europe/Paris";
  return new Date(utc + "Z").toLocaleString("fr-FR", { timeZone: tz, hour12: false });
}

function buildServer(db: DatabaseSync): McpServer {
  const server = new McpServer({ name: "trail", version: "0.1.0" });

  server.registerTool("trail_create_account", {
    description: "Create a new client account in Trail and return the ready-to-paste tracker snippet. Always ask the user whether they will install via Google Tag Manager (gtm) or directly in the site HTML header (header) before calling this tool.",
    inputSchema: {
      name:           z.string().describe("Client or company name"),
      domain:         z.string().describe("Client website domain without protocol, e.g. 'client.fr'"),
      install_method: z.enum(["header", "gtm"]).describe("Installation method: 'header' for direct <script> tag in HTML, 'gtm' for Google Tag Manager Custom HTML tag"),
    },
  }, async ({ name, domain, install_method }) => {
    const account_id = domain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const baseUrl = process.env.TRAIL_URL ?? "http://localhost:3000";

    db.prepare("INSERT OR IGNORE INTO accounts (account_id, name, domain) VALUES (?, ?, ?)")
      .run(account_id, name, domain);

    let snippet: string;
    let instructions: string;

    if (install_method === "gtm") {
      snippet = `<script>\n  window.trailConfig = {\n    accountId: "${account_id}"\n  };\n</script>\n<script src="${baseUrl}/t.js" async defer></script>`;
      instructions = `GTM installation:\n1. Dans GTM, créer une nouvelle balise "HTML personnalisé"\n2. Coller le snippet ci-dessous\n3. Déclencher sur : All Pages (ou votre déclencheur principal)\n4. Publier le conteneur`;
    } else {
      snippet = `<script src="${baseUrl}/t.js"\n  data-account-id="${account_id}"\n  async defer></script>`;
      instructions = `Installation dans le <head> du site, avant </head>.`;
    }

    return { content: [{ type: "text", text: `Account created: ${name}\nID: ${account_id}\n\n${instructions}\n\nSnippet:\n\n${snippet}` }] };
  });

  server.registerTool("trail_list_accounts", {
    description: "List all Trail client accounts.",
    inputSchema: {},
  }, async () => {
    const rows = db.prepare("SELECT account_id, name, domain, created_at FROM accounts ORDER BY created_at DESC").all() as
      { account_id: string; name: string; domain: string; created_at: string }[];

    if (!rows.length) return { content: [{ type: "text", text: "No accounts yet." }] };

    const lines = rows.map((r) => `• ${r.name}\n  ID: ${r.account_id}\n  Domain: ${r.domain}\n  Added: ${toLocalTime(r.created_at)}`);
    return { content: [{ type: "text", text: `Trail accounts (${rows.length}):\n\n${lines.join("\n\n")}` }] };
  });

  server.registerTool("trail_get_journey", {
    description: "Get the full multi-touch journey for a specific lead.",
    inputSchema: {
      lead_id:    z.string().describe("Lead ID (email or CRM ID)"),
      account_id: z.string().describe("Trail account ID"),
    },
  }, async ({ lead_id, account_id }) => {
    const rows = db.prepare("SELECT * FROM visitor_touchpoints WHERE lead_id=? AND account_id=? ORDER BY session_num ASC")
      .all(lead_id, account_id) as Record<string, unknown>[];

    if (!rows.length) return { content: [{ type: "text", text: `No journey found for lead ${lead_id}` }] };

    const lines = rows.map((r) =>
      `Session ${r["session_num"]} — ${toLocalTime(r["created_at"] as string)}\n  Channel: ${r["ch_type"]} | Source: ${r["ch_source"] ?? "direct"} | Campaign: ${r["ch_campaign"] ?? "—"}\n  URL: ${r["landing_url"]}`
    );
    return { content: [{ type: "text", text: `Journey for ${lead_id} (${rows.length} touchpoints):\n\n${lines.join("\n\n")}` }] };
  });

  server.registerTool("trail_get_report", {
    description: "Get an attribution report for an account by channel.",
    inputSchema: {
      account_id: z.string().describe("Trail account ID"),
      model: z.enum(["first_touch", "last_touch", "linear"]).default("last_touch"),
    },
  }, async ({ account_id, model }) => {
    const rows = db.prepare(`
      SELECT ch_type,
        COUNT(DISTINCT lead_id) as leads,
        SUM(CASE WHEN converted=1 THEN 1 ELSE 0 END) as conversions
      FROM visitor_touchpoints
      WHERE account_id=? AND lead_id IS NOT NULL
      GROUP BY ch_type ORDER BY conversions DESC
    `).all(account_id) as { ch_type: string; leads: number; conversions: number }[];

    if (!rows.length) return { content: [{ type: "text", text: "No attribution data found." }] };

    const total = rows.reduce((s, r) => s + r.leads, 0);
    const lines = rows.map((r) => {
      const pct = total > 0 ? Math.round((r.leads / total) * 100) : 0;
      return `${r.ch_type.padEnd(20)} ${String(r.leads).padStart(4)} leads (${pct}%)  |  ${r.conversions} conversions`;
    });
    return { content: [{ type: "text", text: `Attribution — model: ${model}\n\n${"Channel".padEnd(20)} Leads        Conversions\n${"─".repeat(55)}\n${lines.join("\n")}` }] };
  });

  server.registerTool("trail_get_top_paths", {
    description: "Get the most common multi-touch paths before converting.",
    inputSchema: {
      account_id: z.string().describe("Trail account ID"),
      limit: z.number().int().min(1).max(20).default(10),
    },
  }, async ({ account_id, limit }) => {
    const rows = db.prepare(`
      SELECT lead_id, GROUP_CONCAT(ch_type, ' → ') as path
      FROM (SELECT lead_id, ch_type FROM visitor_touchpoints WHERE account_id=? AND lead_id IS NOT NULL ORDER BY lead_id, session_num)
      GROUP BY lead_id
    `).all(account_id) as { lead_id: string; path: string }[];

    if (!rows.length) return { content: [{ type: "text", text: "No path data found." }] };

    const freq: Record<string, number> = {};
    for (const r of rows) freq[r.path] = (freq[r.path] ?? 0) + 1;

    const paths = Object.entries(freq)
      .sort(([, a], [, b]) => b - a).slice(0, limit)
      .map(([path, count], i) => `${i + 1}. ${path}  (${count} leads)`);

    return { content: [{ type: "text", text: `Top ${limit} paths:\n\n${paths.join("\n")}` }] };
  });

  server.registerTool("trail_get_channel_performance", {
    description: "Get channel performance: visitors, leads, conversions, and rate.",
    inputSchema: { account_id: z.string().describe("Trail account ID") },
  }, async ({ account_id }) => {
    const rows = db.prepare(`
      SELECT ch_type,
        COUNT(DISTINCT visitor_id) as visitors,
        COUNT(DISTINCT lead_id) as leads,
        SUM(CASE WHEN converted=1 THEN 1 ELSE 0 END) as conversions
      FROM visitor_touchpoints WHERE account_id=?
      GROUP BY ch_type ORDER BY leads DESC
    `).all(account_id) as { ch_type: string; visitors: number; leads: number; conversions: number }[];

    if (!rows.length) return { content: [{ type: "text", text: "No performance data found." }] };

    const lines = rows.map((r) => {
      const rate = r.leads > 0 ? Math.round((r.conversions / r.leads) * 100) : 0;
      return `${r.ch_type.padEnd(20)} ${String(r.visitors).padStart(6)} visitors  ${String(r.leads).padStart(4)} leads  ${r.conversions} won  (${rate}%)`;
    });
    return { content: [{ type: "text", text: `Channel performance:\n\n${"Channel".padEnd(20)} Visitors  Leads   Won   Rate\n${"─".repeat(60)}\n${lines.join("\n")}` }] };
  });

  server.registerTool("trail_list_leads", {
    description: "List all leads (form submissions) for an account, with their channel and date.",
    inputSchema: {
      account_id: z.string().describe("Trail account ID"),
      limit: z.number().int().min(1).max(100).default(20),
    },
  }, async ({ account_id, limit }) => {
    const rows = db.prepare(`
      SELECT lead_id, ch_type, created_at
      FROM visitor_touchpoints
      WHERE account_id=? AND lead_id IS NOT NULL
      GROUP BY lead_id
      ORDER BY MAX(created_at) DESC
      LIMIT ?
    `).all(account_id, limit) as { lead_id: string; ch_type: string; created_at: string }[];

    if (!rows.length) return { content: [{ type: "text", text: "No leads found." }] };

    const lines = rows.map((r) => `• ${r.lead_id}  |  ${r.ch_type}  |  ${toLocalTime(r.created_at)}`);
    return { content: [{ type: "text", text: `Leads (${rows.length}):\n\n${lines.join("\n")}` }] };
  });

  return server;
}

export function createMcpHandler(db: DatabaseSync) {
  return async (c: Context) => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildServer(db);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  };
}

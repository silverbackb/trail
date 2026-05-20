import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Context } from "hono";
import type { DatabaseSync } from "node:sqlite";

function toLocalTime(utc: string): string {
  const tz = process.env.TRAIL_TZ ?? "Europe/Paris";
  return new Date(utc + "Z").toLocaleString("fr-FR", { timeZone: tz, hour12: false });
}

export function buildServer(db: DatabaseSync): McpServer {
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
    description: "List all Trail client accounts with their account_id. Use this first to get the account_id needed by all other tools.",
    inputSchema: {},
  }, async () => {
    const rows = db.prepare("SELECT account_id, name, domain, created_at FROM accounts ORDER BY created_at DESC").all() as
      { account_id: string; name: string; domain: string; created_at: string }[];

    if (!rows.length) return { content: [{ type: "text", text: "No accounts yet." }] };

    const lines = rows.map((r) => `• ${r.name}\n  ID: ${r.account_id}\n  Domain: ${r.domain}\n  Added: ${toLocalTime(r.created_at)}`);
    return { content: [{ type: "text", text: `Trail accounts (${rows.length}):\n\n${lines.join("\n\n")}` }] };
  });

  server.registerTool("trail_get_recent_sessions", {
    description: "Get the most recent tracking sessions (page visits) for an account. Use this to verify the tracker is installed and working — it shows raw sessions even if no form has been submitted yet. If the list is empty, the tracker is not firing. If it has entries, tracking is working correctly.",
    inputSchema: {
      account_id: z.string().describe("Trail account ID"),
      limit: z.number().int().min(1).max(50).default(10),
    },
  }, async ({ account_id, limit }) => {
    const rows = db.prepare(`
      SELECT visitor_id, ch_type, ch_source, ch_campaign, landing_url, lead_id, created_at
      FROM visitor_touchpoints
      WHERE account_id=?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(account_id, limit) as { visitor_id: string; ch_type: string; ch_source: string | null; ch_campaign: string | null; landing_url: string | null; lead_id: string | null; created_at: string }[];

    if (!rows.length) return { content: [{ type: "text", text: `No sessions found for account "${account_id}". The tracker is either not installed, not yet triggered, or using a different account_id.` }] };

    const lines = rows.map((r) => {
      const source = r.ch_source ? ` | source: ${r.ch_source}` : "";
      const campaign = r.ch_campaign ? ` | campaign: ${r.ch_campaign}` : "";
      const url = r.landing_url ? ` | url: ${r.landing_url}` : "";
      const lead = r.lead_id ? ` | lead: ${r.lead_id}` : "";
      return `${toLocalTime(r.created_at)}  ${r.ch_type}${source}${campaign}${url}${lead}`;
    });
    return { content: [{ type: "text", text: `✓ Tracker is working — ${rows.length} sessions recorded for "${account_id}":\n\n${lines.join("\n")}` }] };
  });

  server.registerTool("trail_get_journey", {
    description: "Get the full multi-touch journey for a specific lead (visitor who submitted a form). Requires a lead_id, which is the email or ID captured at form submission. If the visitor has not submitted a form yet, use trail_get_recent_sessions instead to see their raw sessions.",
    inputSchema: {
      lead_id:    z.string().describe("Lead ID — the email or CRM ID captured when the visitor submitted a form"),
      account_id: z.string().describe("Trail account ID"),
    },
  }, async ({ lead_id, account_id }) => {
    const rows = db.prepare("SELECT * FROM visitor_touchpoints WHERE lead_id=? AND account_id=? ORDER BY session_num ASC")
      .all(lead_id, account_id) as Record<string, unknown>[];

    if (!rows.length) return { content: [{ type: "text", text: `No journey found for lead "${lead_id}" on account "${account_id}". This lead either does not exist or has not submitted a form yet. Use trail_list_leads to see all known leads.` }] };

    const lines = rows.map((r) =>
      `Session ${r["session_num"]} — ${toLocalTime(r["created_at"] as string)}\n  Channel: ${r["ch_type"]} | Source: ${r["ch_source"] ?? "direct"} | Campaign: ${r["ch_campaign"] ?? "—"}\n  URL: ${r["landing_url"]}`
    );
    return { content: [{ type: "text", text: `Journey for ${lead_id} (${rows.length} touchpoints):\n\n${lines.join("\n\n")}` }] };
  });

  server.registerTool("trail_get_report", {
    description: "Get an attribution report broken down by channel. Only counts visitors who submitted a form (leads). Use trail_get_channel_performance for a view that includes all visitors including non-converted ones.",
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

    if (!rows.length) return { content: [{ type: "text", text: `No attribution data for "${account_id}". No form submissions have been recorded yet. To verify the tracker is working, use trail_get_recent_sessions.` }] };

    const total = rows.reduce((s, r) => s + r.leads, 0);
    const lines = rows.map((r) => {
      const pct = total > 0 ? Math.round((r.leads / total) * 100) : 0;
      return `${r.ch_type.padEnd(20)} ${String(r.leads).padStart(4)} leads (${pct}%)  |  ${r.conversions} conversions`;
    });
    return { content: [{ type: "text", text: `Attribution — model: ${model}\n\n${"Channel".padEnd(20)} Leads        Conversions\n${"─".repeat(55)}\n${lines.join("\n")}` }] };
  });

  server.registerTool("trail_get_top_paths", {
    description: "Get the most common multi-touch channel sequences before a form submission. Only works with leads (visitors who submitted a form). Returns empty if no conversions have happened yet.",
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

    if (!rows.length) return { content: [{ type: "text", text: "No path data found. No form submissions have been recorded yet." }] };

    const freq: Record<string, number> = {};
    for (const r of rows) freq[r.path] = (freq[r.path] ?? 0) + 1;

    const paths = Object.entries(freq)
      .sort(([, a], [, b]) => b - a).slice(0, limit)
      .map(([path, count], i) => `${i + 1}. ${path}  (${count} leads)`);

    return { content: [{ type: "text", text: `Top ${limit} paths:\n\n${paths.join("\n")}` }] };
  });

  server.registerTool("trail_get_channel_performance", {
    description: "Get a full performance breakdown by channel: total visitors (all sessions), leads (form submissions), and conversion rate. Unlike trail_get_report, this shows ALL visitors including those who never submitted a form. Use this to understand traffic quality per channel.",
    inputSchema: { account_id: z.string().describe("Trail account ID") },
  }, async ({ account_id }) => {
    const rows = db.prepare(`
      SELECT ch_type,
        COUNT(DISTINCT visitor_id) as visitors,
        COUNT(DISTINCT lead_id) as leads,
        SUM(CASE WHEN converted=1 THEN 1 ELSE 0 END) as conversions
      FROM visitor_touchpoints WHERE account_id=?
      GROUP BY ch_type ORDER BY visitors DESC
    `).all(account_id) as { ch_type: string; visitors: number; leads: number; conversions: number }[];

    if (!rows.length) return { content: [{ type: "text", text: `No data for "${account_id}". The tracker has not recorded any sessions yet. Check that the snippet is installed and that the account_id matches exactly.` }] };

    const lines = rows.map((r) => {
      const rate = r.leads > 0 ? Math.round((r.conversions / r.leads) * 100) : 0;
      return `${r.ch_type.padEnd(20)} ${String(r.visitors).padStart(6)} visitors  ${String(r.leads).padStart(4)} leads  ${r.conversions} won  (${rate}%)`;
    });
    return { content: [{ type: "text", text: `Channel performance:\n\n${"Channel".padEnd(20)} Visitors  Leads   Won   Rate\n${"─".repeat(60)}\n${lines.join("\n")}` }] };
  });

  server.registerTool("trail_list_leads", {
    description: "List visitors who submitted a form (leads) for an account. IMPORTANT: this only returns data after a visitor has submitted a form on the client's website — it will be empty if no form submission has happened yet, even if the tracker is installed and working. To verify the tracker is working without form submissions, use trail_get_recent_sessions instead.",
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

    if (!rows.length) return { content: [{ type: "text", text: `No leads yet for "${account_id}". No visitor has submitted a form on this account's website. The tracker may still be working correctly — use trail_get_recent_sessions to check.` }] };

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

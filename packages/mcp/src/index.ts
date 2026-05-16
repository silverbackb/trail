import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export interface Env {
  DB: D1Database;
}

function buildServer(db: D1Database): McpServer {
  const server = new McpServer({ name: "trail", version: "0.1.0" });

  server.registerTool(
    "trail_create_account",
    {
      description: "Create a new client account in Trail and return the ready-to-paste tracker snippet. Use this when onboarding a new client.",
      inputSchema: {
        name:   z.string().describe("Client or company name, e.g. 'Veillance Contrôle'"),
        domain: z.string().describe("Client website domain without protocol, e.g. 'veillance-controle.fr'"),
      },
    },
    async ({ name, domain }) => {
      const account_id = domain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

      await db.prepare("INSERT OR IGNORE INTO accounts (account_id, name, domain) VALUES (?, ?, ?)")
        .bind(account_id, name, domain).run();

      const snippet = `<script src="https://trail-api.cvescan-pro.workers.dev/t.js"\n  data-account-id="${account_id}"\n  async defer></script>`;

      return {
        content: [{ type: "text", text: `Account created: ${name}\nAccount ID: ${account_id}\n\nTracker snippet (paste before </body>):\n\n${snippet}` }],
      };
    }
  );

  server.registerTool(
    "trail_list_accounts",
    {
      description: "List all Trail client accounts.",
      inputSchema: {},
    },
    async () => {
      const rows = await db
        .prepare("SELECT account_id, name, domain, created_at FROM accounts ORDER BY created_at DESC")
        .all<{ account_id: string; name: string; domain: string; created_at: string }>();

      if (!rows.results.length) {
        return { content: [{ type: "text", text: "No accounts yet. Use trail_create_account to add your first client." }] };
      }

      const lines = rows.results.map((r) =>
        `• ${r.name}\n  ID: ${r.account_id}\n  Domain: ${r.domain}\n  Added: ${r.created_at}`
      );

      return { content: [{ type: "text", text: `Trail accounts (${rows.results.length}):\n\n${lines.join("\n\n")}` }] };
    }
  );

  server.registerTool(
    "trail_get_journey",
    {
      description: "Get the full multi-touch journey for a specific lead. Returns each touchpoint in chronological order with channel, source, and timestamp.",
      inputSchema: {
        lead_id:    z.string().describe("The lead ID (email or CRM ID) from a form submission"),
        account_id: z.string().describe("Your Trail account ID"),
      },
    },
    async ({ lead_id, account_id }) => {
      const rows = await db
        .prepare("SELECT * FROM visitor_touchpoints WHERE lead_id=? AND account_id=? ORDER BY session_num ASC")
        .bind(lead_id, account_id).all();

      if (!rows.results.length) {
        return { content: [{ type: "text", text: `No journey found for lead ${lead_id}` }] };
      }

      const lines = rows.results.map((r: Record<string, unknown>) =>
        `Session ${r["session_num"]} — ${r["created_at"]}\n  Channel: ${r["ch_type"]} | Source: ${r["ch_source"] ?? "direct"} | Campaign: ${r["ch_campaign"] ?? "—"}\n  URL: ${r["landing_url"]}`
      );

      return {
        content: [{ type: "text", text: `Journey for lead ${lead_id} (${rows.results.length} touchpoints):\n\n${lines.join("\n\n")}` }],
      };
    }
  );

  server.registerTool(
    "trail_get_report",
    {
      description: "Get an attribution report for an account. Returns leads and conversions by channel. Model options: first_touch, last_touch (default), linear.",
      inputSchema: {
        account_id: z.string().describe("Your Trail account ID"),
        model: z.enum(["first_touch", "last_touch", "linear"]).default("last_touch").describe("Attribution model"),
      },
    },
    async ({ account_id, model }) => {
      const rows = await db
        .prepare(`
          SELECT ch_type,
            COUNT(DISTINCT lead_id) as leads,
            SUM(CASE WHEN converted=1 THEN 1 ELSE 0 END) as conversions
          FROM visitor_touchpoints
          WHERE account_id=? AND lead_id IS NOT NULL
          GROUP BY ch_type ORDER BY conversions DESC
        `)
        .bind(account_id)
        .all<{ ch_type: string; leads: number; conversions: number }>();

      if (!rows.results.length) {
        return { content: [{ type: "text", text: "No attribution data found for this account." }] };
      }

      const total = rows.results.reduce((s, r) => s + r.leads, 0);
      const lines = rows.results.map((r) => {
        const pct = total > 0 ? Math.round((r.leads / total) * 100) : 0;
        return `${r.ch_type.padEnd(20)} ${String(r.leads).padStart(4)} leads (${pct}%)  |  ${r.conversions} conversions`;
      });

      return {
        content: [{ type: "text", text: `Attribution report — model: ${model}\n\n${"Channel".padEnd(20)} Leads        Conversions\n${"─".repeat(55)}\n${lines.join("\n")}` }],
      };
    }
  );

  server.registerTool(
    "trail_get_top_paths",
    {
      description: "Get the most common multi-touch paths taken by leads before converting.",
      inputSchema: {
        account_id: z.string().describe("Your Trail account ID"),
        limit: z.number().int().min(1).max(20).default(10).describe("Number of top paths to return"),
      },
    },
    async ({ account_id, limit }) => {
      const rows = await db
        .prepare(`
          SELECT lead_id, GROUP_CONCAT(ch_type, ' → ') as path
          FROM (
            SELECT lead_id, ch_type FROM visitor_touchpoints
            WHERE account_id=? AND lead_id IS NOT NULL
            ORDER BY lead_id, session_num
          )
          GROUP BY lead_id
        `)
        .bind(account_id)
        .all<{ lead_id: string; path: string }>();

      if (!rows.results.length) {
        return { content: [{ type: "text", text: "No path data found." }] };
      }

      const freq: Record<string, number> = {};
      for (const row of rows.results) freq[row.path] = (freq[row.path] ?? 0) + 1;

      const paths = Object.entries(freq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, limit)
        .map(([path, count], i) => `${i + 1}. ${path}  (${count} leads)`);

      return { content: [{ type: "text", text: `Top ${limit} conversion paths:\n\n${paths.join("\n")}` }] };
    }
  );

  server.registerTool(
    "trail_get_channel_performance",
    {
      description: "Get channel performance breakdown: leads, conversions, and conversion rate per channel.",
      inputSchema: {
        account_id: z.string().describe("Your Trail account ID"),
      },
    },
    async ({ account_id }) => {
      const rows = await db
        .prepare(`
          SELECT ch_type,
            COUNT(DISTINCT visitor_id) as visitors,
            COUNT(DISTINCT lead_id) as leads,
            SUM(CASE WHEN converted=1 THEN 1 ELSE 0 END) as conversions
          FROM visitor_touchpoints WHERE account_id=?
          GROUP BY ch_type ORDER BY leads DESC
        `)
        .bind(account_id)
        .all<{ ch_type: string; visitors: number; leads: number; conversions: number }>();

      if (!rows.results.length) {
        return { content: [{ type: "text", text: "No performance data found." }] };
      }

      const lines = rows.results.map((r) => {
        const rate = r.leads > 0 ? Math.round((r.conversions / r.leads) * 100) : 0;
        return `${r.ch_type.padEnd(20)} ${String(r.visitors).padStart(6)} visitors  ${String(r.leads).padStart(4)} leads  ${String(r.conversions).padStart(4)} won  (${rate}% rate)`;
      });

      return {
        content: [{ type: "text", text: `Channel performance:\n\n${"Channel".padEnd(20)} Visitors  Leads   Won    Rate\n${"─".repeat(65)}\n${lines.join("\n")}` }],
      };
    }
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — works on any runtime
    });

    const server = buildServer(env.DB);
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

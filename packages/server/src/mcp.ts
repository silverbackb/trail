import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Context } from "hono";
import type { TrailDB } from "./db.js";

function toLocalTime(utc: string): string {
  const tz = process.env.TRAIL_TZ ?? "Europe/Paris";
  const suffix = utc.includes("T") ? "" : "Z";
  return new Date(utc + suffix).toLocaleString("fr-FR", { timeZone: tz, hour12: false });
}

export function buildServer(db: TrailDB, workspaceId: string | null = null): McpServer {
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

    await db.createAccount(account_id, name, domain, workspaceId);

    let snippet: string;
    let instructions: string;

    if (install_method === "gtm") {
      snippet = `<script>\n  window.trailConfig = {\n    accountId: "${account_id}"\n  };\n</script>\n<script src="${baseUrl}/t.js" async defer></script>`;
      instructions = `GTM installation:\n1. Dans GTM, créer une nouvelle balise "HTML personnalisé"\n2. Coller le snippet ci-dessous\n3. Déclencher sur : All Pages (ou votre déclencheur principal)\n4. Publier le conteneur`;
    } else {
      snippet = `<script src="${baseUrl}/t.js"\n  data-account-id="${account_id}"\n  async defer></script>`;
      instructions = `Installation dans le <head> du site, avant </head>.`;
    }

    const convertSnippet = `// À appeler au submit du formulaire (côté client)
fetch('${baseUrl}/convert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    visitor_id: document.cookie.match(/trail_vid=([^;]+)/)?.[1] ?? '',
    account_id: '${account_id}',
    lead_id: document.querySelector('[name="email"]')?.value ?? '',
  }),
});`;

    return { content: [{ type: "text", text: `Account created: ${name}\nID: ${account_id}\n\n${instructions}\n\nSnippet tracker:\n\n${snippet}\n\n─────────────────────────────\nÉtape 2 — Tracker la conversion (submit formulaire) :\n\n${convertSnippet}\n\nRemplacez lead_id par l'email ou l'identifiant du lead capturé dans votre formulaire.` }] };
  });

  server.registerTool("trail_list_accounts", {
    description: "List all Trail client accounts with their account_id. Use this first to get the account_id needed by all other tools.",
    inputSchema: {},
  }, async () => {
    const rows = await db.listAccounts(workspaceId);
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
    const hasAccess = await db.checkAccountAccess(account_id, workspaceId);
    if (!hasAccess) return { content: [{ type: "text", text: `Error: Account "${account_id}" not found or access denied.` }] };

    const rows = await db.getRecentSessions(account_id, limit);
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
    const hasAccess = await db.checkAccountAccess(account_id, workspaceId);
    if (!hasAccess) return { content: [{ type: "text", text: `Error: Account "${account_id}" not found or access denied.` }] };

    const rows = await db.getJourneyByLead(lead_id, account_id);
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
    const hasAccess = await db.checkAccountAccess(account_id, workspaceId);
    if (!hasAccess) return { content: [{ type: "text", text: `Error: Account "${account_id}" not found or access denied.` }] };

    const rows = await db.getChannelReport(account_id);
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
    const hasAccess = await db.checkAccountAccess(account_id, workspaceId);
    if (!hasAccess) return { content: [{ type: "text", text: `Error: Account "${account_id}" not found or access denied.` }] };

    const rows = await db.getTopPaths(account_id);
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
    const hasAccess = await db.checkAccountAccess(account_id, workspaceId);
    if (!hasAccess) return { content: [{ type: "text", text: `Error: Account "${account_id}" not found or access denied.` }] };

    const rows = await db.getChannelPerformance(account_id);
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
    const hasAccess = await db.checkAccountAccess(account_id, workspaceId);
    if (!hasAccess) return { content: [{ type: "text", text: `Error: Account "${account_id}" not found or access denied.` }] };

    const rows = await db.listLeads(account_id, limit);
    if (!rows.length) return { content: [{ type: "text", text: `No leads yet for "${account_id}". No visitor has submitted a form on this account's website. The tracker may still be working correctly — use trail_get_recent_sessions to check.` }] };
    const lines = rows.map((r) => `• ${r.lead_id}  |  ${r.ch_type}  |  ${toLocalTime(r.created_at)}`);
    return { content: [{ type: "text", text: `Leads (${rows.length}):\n\n${lines.join("\n")}` }] };
  });

  server.registerTool("trail_get_first_touch_by_hour", {
    description: "Get the distribution of leads by hour of first contact. Useful to determine if a time slot (e.g., 08h-09h) generates first-touch leads that convert later in the day.",
    inputSchema: {
      account_id: z.string().describe("Trail account ID"),
    },
  }, async ({ account_id }) => {
    const hasAccess = await db.checkAccountAccess(account_id, workspaceId);
    if (!hasAccess) return { content: [{ type: "text", text: `Error: Account "${account_id}" not found or access denied.` }] };

    const data = await db.getFirstTouchByHour(account_id);
    if (!data.length) return { content: [{ type: "text", text: `No converted leads found for account "${account_id}". No first-touch distribution available yet.` }] };

    const lines = data.map(r => `${String(r.hour).padStart(2, "0")}h  ${String(r.leads).padStart(4)} leads  (${r.pct_of_total}%)`);
    return { content: [{ type: "text", text: `First-touch by hour — ${account_id}:\n\nHour  Leads  % of total\n${"─".repeat(30)}\n${lines.join("\n")}` }] };
  });

  return server;
}

export function createMcpHandler(db: TrailDB) {
  return async (c: Context) => {
    const workspaceId = c.get("workspaceId") as string | null;
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildServer(db, workspaceId);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  };
}

# Trail

Multi-touch attribution tracker. Rebuilds the full visitor journey before a form submission — without a CRM, without a dashboard.

The interface is your AI agent.

---

## What it does

Trail drops a lightweight script (~3kb) on your site. It tracks every session a visitor has before converting, stores the channel for each one, and links them to a lead ID when a form is submitted.

```
Session 1 — google_ads        (clicked a Google Ad)
Session 2 — direct            (came back directly)
Session 3 — google_profile    (clicked the Google Business link)
               ↓
         form submitted → trail_vid injected → lead linked to all 3 touchpoints
```

Query the data through an MCP server — ask your AI agent "where are my leads coming from?" and get a real answer.

---

## Channel detection

| Signal | Channel |
|--------|---------|
| `gclid` | `google_ads` |
| `fbclid` | `facebook_ads` |
| `li_fat_id` | `linkedin_ads` |
| `ttclid` | `tiktok_ads` |
| `utm_source=X` | exact value (e.g. `google_profile`, `newsletter`) |
| Referrer = search engine | `organic_search` |
| Referrer = social network | `organic_social` |
| Nothing | `direct` |

Click IDs (`gclid`, `fbclid`…) take priority over `utm_source`. UTM parameters are persisted in `sessionStorage` — if a visitor lands with UTMs then navigates to `/contact`, the channel is preserved when they submit the form.

---

## Installation

### Self-hosted (Node.js + SQLite)

Requires Node.js 22+.

```bash
npm install @silverbackbase/trail
```

Or run directly:

```bash
npx @silverbackbase/trail
```

Starts on `http://localhost:3000`. SQLite database created automatically at `~/.trail/trail.db`.

Add the tracker to your site:

```html
<script src="http://localhost:3000/t.js"
  data-account-id="your-site"
  async defer></script>
```

### Deploy to Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com)

```bash
git clone https://github.com/silverbackb/Trail.git
cd trail
pnpm install
pnpm --filter @trail/tracker run build
pnpm --filter @silverbackbase/trail run build
```

**Required environment variables:**

| Variable | Description |
|----------|-------------|
| `TRAIL_URL` | Public URL of your Trail instance (e.g. `https://trail.yoursite.com`) |
| `DATABASE_URL` | PostgreSQL connection string. If set, Trail uses Postgres. If absent, falls back to SQLite. |
| `DB_PATH` | SQLite file path (default: `./trail.db`). Only used when `DATABASE_URL` is not set. |
| `TRAIL_TZ` | Timezone for MCP output (default: `Europe/Paris`) |

**Storage:** Trail automatically picks the right adapter at startup — PostgreSQL when `DATABASE_URL` is set, SQLite otherwise. No migration needed: if PostgreSQL is empty on first start and a SQLite file exists, Trail migrates the data automatically.

---

## GTM installation

If you use Google Tag Manager, create a **Custom HTML** tag with two script blocks:

```html
<script>
  window.trailConfig = {
    accountId: "your-site"
  };
</script>
<script src="https://trail.silverbackbase.com/t.js" async defer></script>
```

Set trigger to **All Pages**.

---

## Form conversion

Trail automatically detects form submissions. At submit time, it injects a hidden `trail_vid` field into the form — your backend, CRM, or webhook receives it alongside the other form fields, no extra code required.

To manually trigger a conversion (e.g. from a custom flow):

```javascript
fetch('https://trail.silverbackbase.com/convert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    visitor_id: document.cookie.match(/trail_vid=([^;]+)/)?.[1],
    account_id: 'your-site',
    lead_id: 'contact@example.com',
  }),
});
```

---

## MCP server

Trail exposes an MCP server so your AI agent can query attribution data directly.

### Self-hosted (stdio — recommended for local use)

Add to your `.mcp.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "trail": {
      "command": "npx",
      "args": ["-y", "--package=@silverbackbase/trail", "trail-mcp"]
    }
  }
}
```

The MCP server connects to the same SQLite database as your local Trail server.

### Cloud (HTTP)

**Claude Code:**
```bash
claude mcp add trail --transport http https://trail.silverbackbase.com/mcp
```

**Claude Desktop / Cursor** (`mcp.json`):
```json
{
  "mcpServers": {
    "trail": {
      "type": "http",
      "url": "https://trail.silverbackbase.com/mcp"
    }
  }
}
```

Available tools:

| Tool | Description |
|------|-------------|
| `trail_create_account` | Create a client account, get the tracker snippet (header or GTM) |
| `trail_list_accounts` | List all accounts |
| `trail_get_recent_sessions` | Check that the tracker is receiving visits (no conversion required) |
| `trail_list_leads` | List leads with acquisition channel and conversion date |
| `trail_get_journey` | Full touchpoint journey for a lead |
| `trail_get_report` | Attribution report by channel (first / last / linear) |
| `trail_get_top_paths` | Most common multi-touch paths before conversion |
| `trail_get_channel_performance` | Visitors / leads / conversion rate per channel |

---

## Packages

```
packages/
  tracker/   Browser script — visitor ID, session detection, channel capture (~3kb)
  server/    Node.js server — HTTP API + MCP + SQLite / PostgreSQL
```

---

## Stack

- **Tracker** — vanilla TypeScript, compiled to ~3kb IIFE via esbuild
- **Server** — Hono + `@hono/node-server`
- **Database** — SQLite via `node:sqlite` (built-in Node 22+) for self-hosted; PostgreSQL via `postgres` for cloud deployments
- **MCP** — `@modelcontextprotocol/sdk` with Streamable HTTP transport

---

## License

MIT — part of the [SilverBackBase](https://silverbackbase.com) ecosystem.

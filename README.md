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
         form submitted → lead linked to all 3 touchpoints
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

UTM parameters are persisted in `sessionStorage` — if a visitor lands with UTMs then navigates to `/contact`, the channel is preserved when they submit the form.

---

## Installation

### Option 1 — Self-hosted (Node.js + SQLite)

```bash
npm install -g @trail/server
trail
```

Starts on `http://localhost:3000`. SQLite database created automatically at `~/.trail/trail.db`.

Add the tracker to your site:

```html
<script src="http://localhost:3000/t.js"
  data-account-id="your-site"
  async defer></script>
```

### Option 2 — Cloudflare Workers + D1

Deploy your own instance on Cloudflare Workers with a D1 database.

```bash
git clone https://github.com/SilverBackBase/Trail.git
cd trail
pnpm install
```

Create the D1 database:

```bash
npx wrangler d1 create trail
# copy the database_id into packages/api/wrangler.toml and packages/mcp/wrangler.toml
```

Apply migrations:

```bash
npx wrangler d1 execute trail --file=packages/api/migrations/001_init.sql --remote
```

Deploy:

```bash
cd packages/api && npx wrangler deploy
cd packages/mcp && npx wrangler deploy
```

---

## GTM installation

If you use Google Tag Manager, create a **Custom HTML** tag with:

```html
<script>window.TRAIL_ACCOUNT_ID = "your-site";</script>
<script src="https://your-api.workers.dev/t.js" async defer></script>
```

Set trigger to **All Pages**.

> GTM strips `data-*` attributes from injected scripts — use `window.TRAIL_ACCOUNT_ID` instead.

---

## MCP server

Trail exposes an MCP server so your AI agent can query attribution data directly.

Add to your `~/.claude.json`:

```json
"trail": {
  "type": "http",
  "url": "https://your-mcp.workers.dev/mcp"
}
```

Available tools:

| Tool | Description |
|------|-------------|
| `trail_create_account` | Create a client account, get the tracker snippet |
| `trail_list_accounts` | List all accounts |
| `trail_get_journey` | Full touchpoint journey for a lead |
| `trail_get_report` | Attribution report by channel |
| `trail_get_top_paths` | Most common multi-touch paths |
| `trail_get_channel_performance` | Visitors / leads / conversions per channel |

---

## Packages

```
packages/
  tracker/   Browser script — visitor ID, session detection, channel capture
  api/       HTTP API — receives touchpoints, stores to DB
  mcp/       MCP server — exposes attribution tools to AI agents
```

---

## Stack

- **Tracker** — vanilla TypeScript, compiled to ~3kb IIFE via esbuild
- **API** — Hono (runs on Cloudflare Workers or Node.js)
- **Database** — Cloudflare D1 (cloud) or SQLite via better-sqlite3 (self-hosted)
- **MCP** — `@modelcontextprotocol/sdk` with stateless Streamable HTTP transport

---

## License

MIT — part of the [SilverBackBase](https://github.com/SilverBackBase) ecosystem.

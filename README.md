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

Click IDs (`gclid`, `fbclid`…) take priority over `utm_source`. UTM parameters and click IDs are persisted in `localStorage` with a 30-day TTL — if a visitor lands via a Google Ad, closes their browser, and returns directly a week later, the original channel is still attributed at conversion time.

---

## Installation

### Self-hosted (Node.js + SQLite)

Requires Node.js 22+.

```bash
DATABASE_URL=postgres://... npx -y --package=@silverbackbase/trail trail
```

Without `DATABASE_URL`, Trail starts on `http://localhost:3000` with a SQLite database created automatically at `./trail.db`.

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

## Conversion signals

Trail automatically detects two types of conversion signals — no configuration required on your site.

### Form submissions

Trail detects form submissions automatically. At submit time, it injects a hidden `trail_vid` field into the form — your backend, CRM, or webhook receives it alongside the other form fields.

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

### Click-to-call and click-to-mail

Trail automatically captures clicks on `<a href="tel:...">` and `<a href="mailto:...">` links — the most common phone and email contact patterns on local business sites.

Each click is recorded as an intent signal with:
- `click_type`: `tel` or `mail`
- `device_type`: `mobile` or `desktop` (a `tel:` click on mobile is a real call attempt; on desktop it may not be)
- The click is linked to the visitor's journey via `trail_vid`

No site configuration needed. The tracker detects these links automatically via event delegation.

Clicks appear in the visitor journey alongside sessions:

```json
GET /journey/:visitor_id
{
  "visitor_id": "...",
  "sessions": [...],
  "clicks": [
    { "click_type": "tel", "device_type": "mobile", "hostname": "example.com", "created_at": "..." }
  ]
}
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

Point your MCP client to your Trail instance:

```json
{
  "mcpServers": {
    "trail": {
      "type": "http",
      "url": "https://your-trail-instance.com/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

Using the hosted version? → [silverbackbase.com](https://www.silverbackbase.com)

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

## Ad blocker bypass (reverse proxy)

By default the tracker points to `trail.silverbackbase.com`. Brave and uBlock Origin block requests to third-party domains. A reverse proxy routes tracking through your own domain — invisible to blockers.

**Next.js** (`next.config.js`):
```js
module.exports = {
  async rewrites() {
    return [
      { source: "/api/t.js", destination: "https://trail.silverbackbase.com/t.js" },
      { source: "/api/t",    destination: "https://trail.silverbackbase.com/t" },
    ];
  },
};
```

Then in the snippet, add `data-api-url=""` so the tracker uses the current domain:
```html
<script src="/api/t.js" data-account-id="..." data-api-url="" async defer></script>
```

**Cloudflare Worker**:
```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = "trail.silverbackbase.com";
    return fetch(new Request(url, request));
  },
};
```

**Nginx**:
```nginx
location /api/t {
  proxy_pass https://trail.silverbackbase.com;
  proxy_set_header Host trail.silverbackbase.com;
}
```

---

## Packages

```
packages/
  tracker/   Browser script — visitor ID, session detection, channel capture (~3kb)
  server/    Node.js server — HTTP API + MCP + SQLite / PostgreSQL
```

---

## Stack

- **Tracker** — vanilla TypeScript, compiled to ~3.5kb IIFE via esbuild
  - Channel persisted in `localStorage` (30-day TTL) — cross-session attribution preserved
  - Scroll depth (`scroll_depth_pct`) and time on page (`time_on_page_sec`) captured at conversion
- **Server** — Hono + `@hono/node-server`
- **Database** — SQLite via `node:sqlite` (built-in Node 22+) for self-hosted; PostgreSQL via `postgres` for cloud deployments
- **MCP** — `@modelcontextprotocol/sdk` with Streamable HTTP transport

---

## License

MIT — part of the [SilverBackBase](https://silverbackbase.com) ecosystem.

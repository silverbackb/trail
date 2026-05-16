# Trail

Multi-touch attribution tracker. Reconstruit le parcours complet d'un visiteur sur plusieurs sessions, avant qu'il soumette un formulaire. Expose les données via un MCP server — l'agent est l'interface.

## Concept

Un visitor_id persistant (cookie 365j) suit le visiteur à travers toutes ses sessions. Chaque nouvelle session (30 min d'inactivité = nouvelle session) enregistre le canal d'entrée (paid_search, organic_search, paid_social, email, referral, direct). Quand le visiteur soumet un formulaire, on lie son visitor_id à un lead_id.

**Phase 1 (actuel)** : le formulaire = conversion. Appel `POST /convert` depuis le site client.
**Phase 2 (futur)** : SEVYA webhook — quand un lead passe `won` dans SEVYA, `converted=1` est mis à jour automatiquement.

## Stack

| Couche | Technologie |
|--------|-------------|
| Runtime | Cloudflare Workers |
| Base de données | Cloudflare D1 (SQLite) — `database_id: 71944b5b-1645-435d-adcc-65e592dd17f9` |
| Framework API | Hono |
| MCP Server | `agents` (McpAgent) + `@modelcontextprotocol/sdk` |
| Tracker build | esbuild → IIFE, 1.8kb minifié |
| Monorepo | pnpm workspaces |

## Packages

```
packages/
  tracker/   Script navigateur — visitor_id, détection session, ping API
  api/       Cloudflare Worker — reçoit touchpoints, stocke en D1
  mcp/       MCP Server — expose 6 outils à l'agent
```

## URLs de production

- API : `https://trail-api.cvescan-pro.workers.dev`
- MCP : `https://trail-mcp.cvescan-pro.workers.dev/mcp`
- Tracker script : `https://trail-api.cvescan-pro.workers.dev/t.js`

## Outils MCP disponibles

| Outil | Description |
|-------|-------------|
| `trail_create_account` | Crée un compte client, retourne le snippet à coller |
| `trail_list_accounts` | Liste tous les clients enregistrés |
| `trail_get_journey` | Parcours complet d'un lead (toutes ses sessions) |
| `trail_get_report` | Rapport d'attribution par canal (first/last/linear) |
| `trail_get_top_paths` | Séquences de canaux les plus fréquentes |
| `trail_get_channel_performance` | Visiteurs / leads / conversions / taux par canal |

## Snippet d'intégration client

L'agent génère ce snippet via `trail_create_account(name, domain)` :

```html
<script src="https://trail-api.cvescan-pro.workers.dev/t.js"
  data-account-id="nom-du-client"
  async defer></script>
```

Pour tracker une conversion (formulaire soumis), appeler depuis le site client :

```javascript
fetch('https://trail-api.cvescan-pro.workers.dev/convert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    visitor_id: getCookie('trail_vid'),
    account_id: 'nom-du-client',
    lead_id: 'id-du-lead-crm',
  }),
});
```

## Déploiement

```bash
# Tracker — rebuild après modification du script
pnpm --filter @trail/tracker run build
pnpm --filter @trail/api run generate:tracker  # embed dans l'API

# Déployer
cd packages/api && npx wrangler deploy
cd packages/mcp && npx wrangler deploy
```

## Base de données

Tables D1 :
- `accounts` — clients enregistrés (`account_id`, `name`, `domain`)
- `visitor_touchpoints` — un enregistrement par session visiteur
- `visitor_sessions` — index de déduplication (session_hash unique)

Migrations dans `packages/api/migrations/`. Pour appliquer en production :
```bash
npx wrangler d1 execute trail --file=packages/api/migrations/<fichier>.sql --remote
```

## Git

Repo : `git@github-silverback:SilverBackBase/Trail.git`
Branche principale : `main`

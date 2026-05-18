# Changelog

## v0.2.0 — 2026-05-18

### Ajouté
- **`trail_get_recent_sessions`** — nouveau tool MCP pour vérifier que le tracker fonctionne sans attendre une conversion (affiche les sessions brutes)
- **`GET /logs/recent`** — endpoint API pour le dashboard live (derniers touchpoints)
- **Snippet GTM** — `trail_create_account` demande désormais la méthode d'installation (header ou GTM) et génère le snippet adapté (`window.trailConfig = { accountId }`)
- **Détection de conversion sans PII** — le tracker détecte automatiquement les soumissions de formulaire et appelle `/convert` avec le `visitor_id` comme placeholder (pas d'email capturé)

### Corrigé
- **`gclid` prend la priorité sur `utm_source`** — une visite Google Ads avec `utm_source=google` + `gclid` est maintenant correctement classifiée en `google_ads` au lieu de `google`
- **Sessions GTM Preview ignorées** — les requêtes provenant de `gtm-msr.appspot.com` (mode debug GTM) sont rejetées côté serveur
- **Capture email supprimée** — le tracker n'interceptait pas les emails dans les formulaires ; la conversion avec email est désormais à la charge du site client via `POST /convert`
- **Auth simplifiée** — `SILVERBACKBASE_URL` active la validation token cloud ; sans cette variable, aucune auth (usage self-hosted)

### Modifié
- Descriptions MCP enrichies : chaque tool explique quand l'utiliser et ce qu'il retourne si vide
- `window.trailConfig.accountId` remplace `window.TRAIL_ACCOUNT_ID` pour l'intégration GTM
- `/convert` permet d'écraser un `lead_id` auto-détecté (visitor_id) par un vrai email

## v0.1.0 — 2026-05-01

- Version initiale : tracking multi-touch, MCP server, SQLite, Railway

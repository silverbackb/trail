# Changelog

## v0.5.2 — 2026-05-21

### Corrigé
- **CLI interactif** : Filtrage du paramètre `init` des arguments de processus lors du lancement interactif avec `npx` pour garantir l'exécution de l'assistant interactif (Cloud vs Local) au lieu de basculer silencieusement en mode local.

## v0.5.1 — 2026-05-21

### Ajouté
- **Migration automatique à la volée** : Association automatique des comptes historiques `NULL` au workspace de l'utilisateur dès le premier accès au tableau de bord.

### Corrigé
- **Logs et synthèses en temps réel** : Prise en compte de l'en-tête `x-workspace-id` lors de la validation d'un jeton d'administration pour permettre au tableau de bord du site web d'afficher les logs en temps réel.

### Modifié
- **Onboarding simplifié** : Mise à jour de la documentation et du site web pour promouvoir la commande interactive `npx @silverbackbase/trail init`.

## v0.5.0 — 2026-05-21

### Ajouté
- **Cinématique d'installation interactive** — initialisation interactive via `npx @silverbackbase/trail init` pour choisir entre Cloud managé et Local open-source.
- **Isolation multi-tenant stricte** — association des clés API avec le `workspaceId` de l'utilisateur pour cloisonner hermétiquement les données au sein de la base de données (SQLite et PostgreSQL).
- **Parité de schéma dynamique** — migration automatique et progressive des bases SQLite et Postgres avec `workspace_id` sur les comptes existants.

## v0.4.3 — 2026-05-20

### Corrigé
- `GET /journey/{visitor_id}` expose maintenant `time_on_page_sec` et `scroll_depth_pct` — ces champs étaient stockés mais absents de la réponse API (Sevya ne les recevait pas)

## v0.4.2 — 2026-05-20

### Ajouté
- **localStorage 30j** — le canal d'acquisition est maintenant persisté dans `localStorage` avec une TTL de 30 jours. Avant : fermer l'onglet effaçait le canal (`sessionStorage`). Maintenant : un visiteur revenu une semaine plus tard via accès direct conserve son attribution d'origine.
- **Scroll depth** — le tracker mesure le pourcentage de scroll maximal atteint avant conversion. Envoyé dans le payload `/convert` (`scroll_depth_pct`).
- **Temps avant conversion** — durée en secondes entre le chargement de la page et la soumission du formulaire (`time_on_page_sec`). Permet des insights du type "les leads LinkedIn passent 3x plus de temps avant de convertir".
- **Colonnes DB** — `time_on_page_sec` et `scroll_depth_pct` ajoutés à `visitor_touchpoints` (SQLite + PostgreSQL). Migration automatique au démarrage pour les bases existantes.

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

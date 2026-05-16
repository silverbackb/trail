# Cahier des Charges — Module Multi-Touch Attribution
**Projet :** Sevya — Tracking Complémentaire Parcours Visiteur
**Date :** 2026-05-13
**Statut :** Draft v1
**Contexte :** Demande initiale de Vincent (utilisateur payant Sevya)

---

## 1. Contexte & Problème

### 1.1 Le besoin
Vincent utilise Sevya pour gérer les leads de ses clients. Il veut comprendre **par quel chemin les prospects passent avant de soumettre un formulaire** : par exemple, "Meta Ads → Google Business → Google Ads → Formulaire". L'objectif est d'attribuer un pourcentage de contribution à chaque canal pour optimiser ses budgets publicitaires.

### 1.2 Pourquoi Sevya ne peut pas répondre seul
Le tracking script de Sevya utilise un **cookie de session uniquement**. Il capture la source marketing au moment de la visite courante et l'envoie au serveur uniquement lors de la soumission du formulaire. Les visites précédentes sans soumission sont perdues — Sevya ne reconstruit pas le parcours multi-session par conception.

Cette contrainte est un **choix architectural volontaire** (RGPD, simplicité, fiabilité) et ne doit pas être modifiée.

### 1.3 La solution retenue
Créer un **Script B complémentaire et indépendant**, posé à côté du Script A (Sevya), qui :
- Pose un identifiant visiteur persistant (`visitor_id`)
- Enregistre chaque session avec son canal à chaque nouvelle visite
- Transmet le `visitor_id` au moment de la soumission du formulaire pour que Sevya lie le parcours au lead

Le Script A de Sevya reçoit une **modification minime d'une ligne** pour lire et transmettre ce `visitor_id` dans son payload habituel.

---

## 2. Architecture Générale

```
┌─────────────────────────────────────────────────────────────┐
│                      Site Client                            │
│                                                             │
│   Script A (Sevya — inchangé sauf 1 ligne)                  │
│   → cookie session → capture formulaire → lead              │
│                                                             │
│   Script B (nouveau — complémentaire)                       │
│   → cookie persistant visitor_id                            │
│   → ping serveur à chaque nouvelle session                  │
│   → lit visitor_id au submit → inclus dans payload Sevya    │
└─────────────────┬───────────────────────────────────────────┘
                  │
       ┌──────────┴──────────┐
       │                     │
┌──────▼──────┐    ┌─────────▼──────────┐
│  Sevya API  │    │  Attribution API    │
│  (existant) │    │  (nouveau endpoint) │
│             │    │                     │
│  Lead créé  │    │  Touchpoints stockés│
│  + visitor_id    │  par visitor_id     │
└──────┬──────┘    └─────────┬──────────┘
       │                     │
       └──────────┬──────────┘
                  │
         ┌────────▼────────┐
         │    Dashboard    │
         │   Attribution   │
         │   Analytics     │
         └─────────────────┘
```

---

## 3. Script B — Spécifications Client-Side

### 3.1 Responsabilités
- Générer et persister un `visitor_id` unique par navigateur
- Détecter chaque nouvelle session et enregistrer sa source
- Exposer le `visitor_id` via cookie lisible par le Script A

### 3.2 Génération du visitor_id
- Format : UUID v4 (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`)
- Stockage : cookie `sevya_vid` — durée **365 jours** — domaine courant
- Comportement : si le cookie existe déjà, ne pas le régénérer
- Jamais transmis à un tiers, jamais utilisé hors du domaine

### 3.3 Détection d'une nouvelle session
Une nouvelle session est détectée si :
- Aucun cookie de session `sevya_vsess` n'existe (durée : 30 minutes, renouvelé à chaque page vue)
- La source marketing (UTM ou referrer) est différente de la dernière session enregistrée

Lors d'une nouvelle session, le Script B :
1. Pose / renouvelle le cookie de session `sevya_vsess`
2. Enregistre un touchpoint via l'Attribution API

### 3.4 Données capturées par touchpoint
```json
{
  "visitor_id": "uuid-v4",
  "account_id": "sevya-account-id",
  "timestamp": "2026-05-13T10:23:00Z",
  "session_number": 3,
  "channel": {
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "plombier-paris",
    "utm_term": "plombier urgence",
    "utm_content": null,
    "gclid": "abc123",
    "fbclid": null,
    "referrer": "https://google.com",
    "referrer_type": "paid_search"
  },
  "page": {
    "landing_url": "https://client.com/contact?utm_source=google...",
    "hostname": "client.com"
  }
}
```

### 3.5 Classification automatique des canaux (`referrer_type`)
| Condition | Valeur |
|---|---|
| `gclid` présent | `paid_search` |
| `fbclid` présent | `paid_social` |
| `utm_medium` = `cpc` | `paid_search` |
| `utm_medium` = `social` | `paid_social` |
| `utm_medium` = `email` | `email` |
| Referrer = moteur de recherche connu | `organic_search` |
| Referrer = réseau social connu | `organic_social` |
| Referrer présent, non classé | `referral` |
| Aucune source détectée | `direct` |

### 3.6 Performance & contraintes techniques
- Taille du script compilé : **< 5 Ko minifié gzippé**
- Chargement asynchrone, ne bloque pas le rendu
- Zéro dépendance externe
- Compatible avec les navigateurs > 2 ans (ES2020)
- Un seul appel réseau par nouvelle session (pas de polling, pas de beacon récurrent)

### 3.7 Intégration sur le site client
```html
<!-- Script B — Multi-Touch Attribution (à placer avant le Script A Sevya) -->
<script
  async
  src="https://cdn.sevya.io/attribution-tracker.js"
  data-account-id="SEVYA_ACCOUNT_ID">
</script>

<!-- Script A Sevya (inchangé) -->
<script async src="https://cdn.sevya.io/tracker.js" data-account-id="SEVYA_ACCOUNT_ID"></script>
```

---

## 4. Modification du Script A (Sevya)

### 4.1 Changement requis
Une seule modification dans `tracking-script/src/modules/api.ts`, ligne 23 du payload :

```typescript
// AVANT
const payload: FormPayload = {
    formData: formData,
    formFields: ...,
    attributionData: { ...attributionData },
    contextData: { ... },
};

// APRÈS — ajout d'une seule ligne
const payload: FormPayload = {
    formData: formData,
    formFields: ...,
    attributionData: { ...attributionData },
    contextData: { ... },
    visitorId: CookieManager.getRaw('sevya_vid') ?? null,  // ← ajout
};
```

### 4.2 Comportement si Script B absent
Si le cookie `sevya_vid` n'existe pas (Script B non installé), `visitorId` vaut `null`. Le backend Sevya ignore silencieusement ce champ. **Aucune régression possible.**

---

## 5. Attribution API — Spécifications Backend

### 5.1 Endpoints

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/attribution/touchpoint` | Enregistrer un touchpoint visiteur |
| `GET` | `/attribution/journey/:lead_id` | Récupérer le parcours d'un lead |
| `GET` | `/attribution/report` | Rapport d'attribution agrégé |

### 5.2 Modèle de données

**Table `visitor_touchpoints`**
```sql
id             UUID PRIMARY KEY
visitor_id     UUID NOT NULL          -- identifiant persistant navigateur
account_id     VARCHAR NOT NULL       -- isolation multi-tenant
lead_id        UUID NULL              -- rempli quand le visiteur soumet un formulaire
session_number INTEGER NOT NULL
channel_source VARCHAR                -- utm_source ou référent classifié
channel_medium VARCHAR
channel_campaign VARCHAR
channel_term   VARCHAR
channel_type   VARCHAR                -- paid_search, organic_social, direct, etc.
gclid          VARCHAR NULL
fbclid         VARCHAR NULL
landing_url    TEXT
referrer       TEXT NULL
created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
converted      BOOLEAN DEFAULT FALSE  -- true quand le lead associé est marqué won
```

**Table `visitor_sessions`** (index de déduplication)
```sql
visitor_id     UUID NOT NULL
account_id     VARCHAR NOT NULL
session_hash   VARCHAR NOT NULL       -- hash(visitor_id + source + date_jour)
created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
UNIQUE(visitor_id, session_hash)
```

### 5.3 Liaison visitor_id → Lead
Quand Sevya reçoit un lead avec un `visitorId` non null :
1. Le backend recherche tous les touchpoints pour ce `visitor_id` et cet `account_id`
2. Il met à jour `lead_id` sur ces touchpoints
3. Quand le lead passe en statut `won`, il met `converted = true` sur tous ses touchpoints

### 5.4 Sécurité & isolation
- Le `account_id` est toujours vérifié côté serveur (pas de trust client)
- Un `visitor_id` ne peut être associé qu'aux leads du même `account_id`
- Rate limiting : max 10 touchpoints par `visitor_id` par heure

---

## 6. Dashboard Analytics — Spécifications UI

### 6.1 Vue principale : Rapport d'attribution par canal

Sélecteur de modèle en haut à droite avec 3 modèles au lancement :

| Modèle | Logique | Cas d'usage |
|---|---|---|
| **First Touch** | 100% au premier canal | Comprendre quoi génère la découverte |
| **Last Touch** | 100% au dernier canal | Comprendre quoi déclenche la conversion |
| **Linear** | Parts égales entre tous les canaux | Vue équilibrée, analyse exploratoire |

Tableau de résultats :
```
Canal           | Leads | % Attribution | Conversions | Taux conv.
----------------|-------|---------------|-------------|----------
Google Ads      |   48  |     42%       |     12      |   25%
Meta Ads        |   31  |     28%       |      7      |   22%
Organique       |   22  |     20%       |      6      |   27%
Direct          |   11  |     10%       |      2      |   18%
```

### 6.2 Vue parcours : Timeline d'un lead

Dans la fiche lead existante de Sevya, un nouvel onglet "Parcours" affiche :

```
Session 1 — 12 jan 2026, 14h23
└─ Meta Ads · Campagne "plombier-paris-nord" · iPhone

Session 2 — 15 jan 2026, 09h11
└─ Google Business Profile · Recherche organique locale · Desktop

Session 3 — 15 jan 2026, 11h47  ← Conversion
└─ Google Ads · Campagne "urgence-plombier" · Desktop
   └─ Formulaire soumis → Lead créé
```

### 6.3 Vue chemins les plus fréquents

Classement des séquences de canaux les plus courantes parmi les leads convertis :

```
1. Meta Ads → Google Ads                    18 conversions  (34%)
2. Google Ads direct                        14 conversions  (26%)
3. Meta Ads → Organique → Google Ads         9 conversions  (17%)
4. Direct → Google Ads                       7 conversions  (13%)
5. Organique direct                          5 conversions  ( 9%)
```

---

## 7. RGPD & Conformité

### 7.1 Nature des données
Le `visitor_id` est un identifiant technique pseudonyme. Il ne contient pas de PII et n'est jamais croisé avec des données personnelles sans soumission de formulaire explicite.

### 7.2 Durée de rétention
- Cookie `sevya_vid` : 365 jours navigateur
- Touchpoints sans `lead_id` (visiteurs non convertis) : **supprimés après 90 jours**
- Touchpoints avec `lead_id` : durée de rétention alignée sur la politique Sevya existante

### 7.3 Gestion du consentement
Le Script B doit respecter le consentement CMP si présent :
- Si la bannière cookies est acceptée → Script B s'initialise normalement
- Si refusée ou en attente → le Script B ne pose pas de cookie persistant, les touchpoints ne sont pas envoyés
- Compatible TCF v2.2

### 7.4 Opt-out
Endpoint dédié : `DELETE /attribution/visitor/:visitor_id` — supprime tous les touchpoints non liés à un lead. Déclenché sur demande de droit à l'effacement.

---

## 8. Périmètre MVP

### 8.1 Inclus dans le MVP
- Script B client-side (génération visitor_id, détection session, ping API)
- Modification d'une ligne dans Script A
- Endpoint `POST /attribution/touchpoint`
- Liaison visitor_id → lead au moment de la création du lead
- Liaison lead → `converted` quand statut `won`
- Onglet "Parcours" dans la fiche lead
- Rapport d'attribution simple (3 modèles : First Touch, Last Touch, Linear)
- Vue "Chemins les plus fréquents"

### 8.2 Hors MVP (futures itérations)
- Modèles U-Shaped, W-Shaped, Time Decay
- Modèles data-driven (Markov, Shapley) — requiert 100+ conversions/mois
- Réconciliation cross-device
- Export CSV du rapport
- Alertes automatiques ("ce canal perd en attribution ce mois-ci")

---

## 9. Questions Ouvertes

| # | Question | Impact |
|---|---|---|
| 1 | Le Script B est-il inclus dans l'abonnement Sevya existant ou en option payante ? | Pricing |
| 2 | Où est hébergé l'Attribution API — dans le backend Sevya existant ou service séparé ? | Architecture |
| 3 | La modification du Script A (1 ligne) est-elle déployée pour tous les clients ou opt-in ? | Rollout |
| 4 | Quel est le volume de touchpoints à anticiper pour le dimensionnement ? | Infra |

---

## 10. Estimation de Charge (Ordre de Grandeur)

| Composant | Complexité |
|---|---|
| Script B client-side | 2-3 jours |
| Modification Script A (1 ligne + type) | 0.5 jour |
| Tables BDD + migrations | 0.5 jour |
| Endpoint POST /touchpoint | 1 jour |
| Liaison visitor → lead dans le flux existant | 1 jour |
| Onglet "Parcours" fiche lead | 2 jours |
| Rapport d'attribution + 3 modèles | 3 jours |
| Vue "Chemins fréquents" | 1 jour |
| Tests & RGPD | 2 jours |
| **Total estimé** | **~13 jours** |

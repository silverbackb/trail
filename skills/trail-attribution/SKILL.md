---
description: Multi-touch attribution analysis using Trail. Use when the user asks about lead acquisition channels, marketing performance, where leads come from, channel ROI, or form conversion paths. Also use to verify that the Trail tracker is working on a client site.
---

# Trail Attribution Skill

Trail reconstructs the full visitor journey before a form submission. It tracks every session across channels (Google Ads, organic search, social, referral, direct) and links them to a lead when a form is submitted.

## When to use Trail tools

- "Where do our leads come from?" → `trail_get_report` or `trail_get_channel_performance`
- "What is the journey of lead X?" → `trail_get_journey`
- "Is the tracker working?" → `trail_get_recent_sessions`
- "What are the most common paths to conversion?" → `trail_get_top_paths`
- "Onboard a new client" → `trail_create_account` (ask for install method: header or GTM)

## Recommended tool chain

1. Always call `trail_list_accounts` first to get the correct `account_id`.
2. To verify the tracker is live: `trail_get_recent_sessions` — shows raw sessions even without form submissions.
3. For attribution analysis: `trail_get_report` (leads only) or `trail_get_channel_performance` (all visitors).
4. For a specific lead: `trail_get_journey` — requires a `lead_id` (the email captured at form submission).

## Key distinctions

- `trail_get_report` — only counts visitors who submitted a form. Good for conversion attribution.
- `trail_get_channel_performance` — shows all visitors including non-converted. Good for traffic quality analysis.
- `trail_get_recent_sessions` — raw session data regardless of form submission. Use to debug tracker installation.
- `trail_list_leads` — lists known emails (form submitters). Will be empty if no form has been submitted yet.

## Attribution models (trail_get_report)

- `first_touch` — credits the first channel the visitor came from
- `last_touch` — credits the channel of the last session before conversion (default)
- `linear` — splits credit equally across all sessions

## Important caveats

- Trail only records data from the moment the snippet is installed on the client's site. Historical data does not exist.
- If `trail_get_recent_sessions` returns empty: the tracker is not firing — check that the snippet is in the page and the `account_id` matches exactly.
- If `trail_list_leads` returns empty but sessions exist: the `POST /convert` call is not being made on form submission. The client needs to implement it.

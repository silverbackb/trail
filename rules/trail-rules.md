# Trail — Agent Rules

## Always call trail_list_accounts first

Never guess or hardcode an `account_id`. Always call `trail_list_accounts` to retrieve the correct ID before calling any other tool.

## Distinguish visitors from leads

- A **visitor** is anyone whose browser loaded the tracker script.
- A **lead** is a visitor who submitted a form (`POST /convert` was called, linking a `visitor_id` to a `lead_id`).
- Many Trail tools only return data for leads. If results are empty, clarify whether `POST /convert` has been implemented on the site.

## Do not invent attribution data

Never generate or estimate attribution numbers from memory. All attribution data must come from Trail MCP tool responses. If Trail returns no data, say so explicitly and suggest the diagnostic steps (check snippet installation, check `POST /convert` implementation).

## Tracker verification before attribution analysis

If a user asks about performance for a new client, always call `trail_get_recent_sessions` first to confirm the tracker is recording sessions. Providing attribution analysis on an account with no data is meaningless.

## Installation method matters

When creating a new account with `trail_create_account`, always ask the user whether they are installing via:
- **`header`** — direct `<script>` tag in the HTML `<head>`
- **`gtm`** — Google Tag Manager Custom HTML tag

The generated snippet differs for each method.

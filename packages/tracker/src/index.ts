import { captureChannel } from "./channel.js";
import { getOrCreateVisitorId, isNewSession } from "./visitor.js";

declare const TRAIL_ACCOUNT_ID: string;
declare const TRAIL_API_URL: string;

let _apiUrl: string;
let _accountId: string;
let _visitorId: string;

function hasCampaignSignal(): boolean {
  const p = new URLSearchParams(location.search);
  return !!(p.get("utm_source") || p.get("gclid") || p.get("fbclid") || p.get("li_fat_id") || p.get("ttclid"));
}

function trackSession(): void {
  const channel = captureChannel();
  const isCampaign = hasCampaignSignal();

  // Campaign clicks always tracked; organic/direct deduplicated by session cookie
  if (!isCampaign && !isNewSession()) return;

  fetch(`${_apiUrl}/t`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      visitor_id: _visitorId,
      account_id: _accountId,
      channel,
      hostname: location.hostname,
    }),
    keepalive: true,
  }).catch(() => {});
}

function trackForms(): void {
  document.addEventListener("submit", (e) => {
    const form = e.target as HTMLFormElement;

    // Try to grab an email as lead_id, fall back to visitor_id
    const emailInput = form.querySelector<HTMLInputElement>(
      'input[type="email"], input[name*="email"], input[id*="email"]'
    );
    const leadId = emailInput?.value?.trim() || _visitorId;

    fetch(`${_apiUrl}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor_id: _visitorId,
        account_id: _accountId,
        lead_id: leadId,
      }),
      keepalive: true,
    }).catch(() => {});
  });
}

function init(): void {
  // Priority: data attribute > window.trailConfig (GTM) > compile-time constant
  const w = window as unknown as { trailConfig?: { accountId?: string; apiUrl?: string } };
  const script = (document.currentScript as HTMLScriptElement | null)
    ?? document.querySelector<HTMLScriptElement>('script[src*="t.js"][data-account-id]');
  _accountId = script?.dataset["accountId"] ?? w.trailConfig?.accountId ?? TRAIL_ACCOUNT_ID;

  // Priority: data-api-url > window.trailConfig.apiUrl > auto-detect from script src > compile-time constant
  const scriptSrc = script?.src;
  const autoUrl = scriptSrc ? new URL(scriptSrc).origin : "";
  _apiUrl = script?.dataset["apiUrl"] ?? w.trailConfig?.apiUrl ?? autoUrl ?? TRAIL_API_URL;
  _visitorId = getOrCreateVisitorId();

  trackSession();
  trackForms();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

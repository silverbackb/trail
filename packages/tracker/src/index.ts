import { captureChannel } from "./channel.js";
import { getOrCreateVisitorId, isNewSession } from "./visitor.js";

declare const TRAIL_ACCOUNT_ID: string;
declare const TRAIL_API_URL: string;

let _apiUrl: string;
let _accountId: string;
let _visitorId: string;

function trackSession(): void {
  if (!isNewSession()) return;

  const channel = captureChannel();

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
  // document.currentScript is null for async scripts (e.g. loaded via GTM)
  // Fall back to querying the DOM for the script element
  const script = (document.currentScript as HTMLScriptElement | null)
    ?? document.querySelector<HTMLScriptElement>('script[src*="t.js"][data-account-id]');
  _accountId = script?.dataset["accountId"] ?? TRAIL_ACCOUNT_ID;
  _apiUrl = script?.dataset["apiUrl"] ?? TRAIL_API_URL;
  _visitorId = getOrCreateVisitorId();

  trackSession();
  trackForms();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

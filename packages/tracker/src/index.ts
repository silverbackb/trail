import { captureChannel } from "./channel.js";
import { getOrCreateVisitorId, isNewSession } from "./visitor.js";

declare const TRAIL_ACCOUNT_ID: string;
declare const TRAIL_API_URL: string;

let _apiUrl: string;
let _accountId: string;
let _visitorId: string;

const _pageStart = Date.now();
let _maxScroll = 0;
window.addEventListener("scroll", () => {
  const pct = Math.round(((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100);
  if (pct > _maxScroll) _maxScroll = pct;
}, { passive: true });

function hasCampaignSignal(): boolean {
  const p = new URLSearchParams(location.search);
  return !!(p.get("utm_source") || p.get("gclid") || p.get("gbraid") || p.get("wbraid") || p.get("gad_campaignid") || p.get("fbclid") || p.get("li_fat_id") || p.get("ttclid"));
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
    const form = e.target instanceof HTMLFormElement ? e.target : null;
    if (form && !form.querySelector('input[name="trail_vid"]')) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "trail_vid";
      input.value = _visitorId;
      form.appendChild(input);
    }

    fetch(`${_apiUrl}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor_id: _visitorId,
        account_id: _accountId,
        lead_id: _visitorId,
        time_on_page_sec: Math.round((Date.now() - _pageStart) / 1000),
        scroll_depth_pct: _maxScroll,
      }),
      keepalive: true,
    }).catch(() => {});
  }, { capture: true });
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

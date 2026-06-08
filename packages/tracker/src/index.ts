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

// Dedup window: a single user action must not produce two /convert calls
// (e.g. native submit event + a later programmatic submit() in the same flow).
const SUBMIT_DEDUP_MS = 3000;
const _lastConvert = new WeakMap<HTMLFormElement, number>();

// Skip site-search forms so a search doesn't count as a conversion.
// Conservative: only skip what is unambiguously a search (a lone search field,
// GET method, no lead field) — anything with an email/phone/message is kept.
function isSearchForm(form: HTMLFormElement): boolean {
  const role = (form.getAttribute("role") ?? "").toLowerCase();
  if (role === "search") return true;

  const hasLeadField = !!form.querySelector(
    'input[type="email"], input[type="tel"], textarea, [name*="mail" i], [name*="phone" i], [name*="tel" i], [name*="nom" i], [name*="name" i], [name*="message" i]'
  );
  if (hasLeadField) return false;

  const hasSearchField = !!form.querySelector(
    'input[type="search"], input[name="s"], input[name="q"], input[name="query"]'
  );
  const method = (form.getAttribute("method") ?? "get").toLowerCase();
  if (hasSearchField && method === "get") return true;

  const meta = `${form.className} ${form.id}`.toLowerCase();
  if (meta.includes("search")) return true;

  return false;
}

function convert(form: HTMLFormElement | null): void {
  if (form) {
    if (isSearchForm(form)) return;

    const now = Date.now();
    const prev = _lastConvert.get(form);
    if (typeof prev === "number" && now - prev < SUBMIT_DEDUP_MS) return;
    _lastConvert.set(form, now);

    if (!form.querySelector('input[name="trail_vid"]')) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "trail_vid";
      input.value = _visitorId;
      form.appendChild(input);
    }
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
}

function trackForms(): void {
  // 1. Native submit event (capture phase) — covers browser-initiated submits
  //    and requestSubmit() (which dispatches a submit event per spec).
  document.addEventListener("submit", (e) => {
    convert(e.target instanceof HTMLFormElement ? e.target : null);
  }, { capture: true });

  // 2. Programmatic form.submit() — does NOT dispatch a submit event, so the
  //    listener above never sees it. This is the path used by AJAX forms
  //    (Gravity Forms, Contact Form 7), invisible reCAPTCHA, and jQuery-driven
  //    submissions. Patch the prototype once to capture them.
  const proto = HTMLFormElement.prototype as HTMLFormElement & { __trailPatched?: boolean };
  if (!proto.__trailPatched) {
    const originalSubmit = proto.submit;
    proto.submit = function (this: HTMLFormElement) {
      try { convert(this); } catch { /* never block the real submit */ }
      return originalSubmit.apply(this);
    };
    proto.__trailPatched = true;
  }
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

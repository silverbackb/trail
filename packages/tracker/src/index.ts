import { captureChannel } from "./channel.js";
import { getOrCreateVisitorId, isNewSession } from "./visitor.js";

declare const TRAIL_ACCOUNT_ID: string;
declare const TRAIL_API_URL: string;

function init(): void {
  const script = document.currentScript as HTMLScriptElement | null;
  const accountId = script?.dataset["accountId"] ?? TRAIL_ACCOUNT_ID;
  const apiUrl = script?.dataset["apiUrl"] ?? TRAIL_API_URL;

  const visitorId = getOrCreateVisitorId();

  if (!isNewSession()) return;

  const channel = captureChannel();

  fetch(`${apiUrl}/t`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      visitor_id: visitorId,
      account_id: accountId,
      channel,
      hostname: location.hostname,
    }),
    keepalive: true,
  }).catch(() => {
    // silent fail — never break the client site
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

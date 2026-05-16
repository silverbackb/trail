export type ChannelType =
  | "paid_search"
  | "paid_social"
  | "organic_search"
  | "organic_social"
  | "email"
  | "referral"
  | "direct";

export interface Channel {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  referrer: string | null;
  referrer_type: ChannelType;
  landing_url: string;
}

const SEARCH_ENGINES = ["google", "bing", "yahoo", "duckduckgo", "yandex", "baidu"];
const SOCIAL_NETWORKS = ["facebook", "instagram", "twitter", "x.com", "linkedin", "tiktok", "youtube", "pinterest"];

function classifyReferrer(referrer: string, params: URLSearchParams): ChannelType {
  const gclid = params.get("gclid");
  const fbclid = params.get("fbclid");
  const medium = params.get("utm_medium")?.toLowerCase();

  if (gclid || medium === "cpc" || medium === "ppc") return "paid_search";
  if (fbclid || medium === "paid_social") return "paid_social";
  if (medium === "email") return "email";
  if (medium === "social" || medium === "social-media") return "organic_social";
  if (medium) return "referral";

  if (!referrer) return "direct";

  try {
    const host = new URL(referrer).hostname.replace("www.", "");
    if (SEARCH_ENGINES.some((e) => host.includes(e))) return "organic_search";
    if (SOCIAL_NETWORKS.some((s) => host.includes(s))) return "organic_social";
    return "referral";
  } catch {
    return "direct";
  }
}

export function captureChannel(): Channel {
  const params = new URLSearchParams(location.search);
  const referrer = document.referrer;

  return {
    utm_source: params.get("utm_source"),
    utm_medium: params.get("utm_medium"),
    utm_campaign: params.get("utm_campaign"),
    utm_term: params.get("utm_term"),
    utm_content: params.get("utm_content"),
    gclid: params.get("gclid"),
    fbclid: params.get("fbclid"),
    referrer: referrer || null,
    referrer_type: classifyReferrer(referrer, params),
    landing_url: location.href,
  };
}

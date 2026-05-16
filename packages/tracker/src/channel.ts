export type ChannelType = string;

export interface Channel {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  li_fat_id: string | null;
  ttclid: string | null;
  referrer: string | null;
  referrer_type: ChannelType;
  landing_url: string;
}

const SEARCH_ENGINES = ["google", "bing", "yahoo", "duckduckgo", "yandex", "baidu"];
const SOCIAL_NETWORKS = ["facebook", "instagram", "twitter", "x.com", "linkedin", "tiktok", "youtube", "pinterest"];

function classifyReferrer(referrer: string, params: URLSearchParams): ChannelType {
  const source = params.get("utm_source");
  if (source) return source;

  const gclid = params.get("gclid");
  const fbclid = params.get("fbclid");
  const li_fat_id = params.get("li_fat_id");
  const ttclid = params.get("ttclid");

  if (gclid) return "google_ads";
  if (fbclid) return "facebook_ads";
  if (li_fat_id) return "linkedin_ads";
  if (ttclid) return "tiktok_ads";

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

const STORAGE_KEY = "trail_channel";

function saveChannel(ch: Channel): void {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ch)); } catch {}
}

function loadChannel(): Channel | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Channel) : null;
  } catch { return null; }
}

export function captureChannel(): Channel {
  const params = new URLSearchParams(location.search);
  const referrer = document.referrer;
  const hasSignal = !!(
    params.get("utm_source") || params.get("gclid") || params.get("fbclid") ||
    params.get("li_fat_id") || params.get("ttclid")
  );

  if (hasSignal) {
    const ch: Channel = {
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_term: params.get("utm_term"),
      utm_content: params.get("utm_content"),
      gclid: params.get("gclid"),
      fbclid: params.get("fbclid"),
      li_fat_id: params.get("li_fat_id"),
      ttclid: params.get("ttclid"),
      referrer: referrer || null,
      referrer_type: classifyReferrer(referrer, params),
      landing_url: location.href,
    };
    saveChannel(ch);
    return ch;
  }

  // No signal in URL — restore from sessionStorage if available
  const stored = loadChannel();
  if (stored) return stored;

  return {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    gclid: null,
    fbclid: null,
    li_fat_id: null,
    ttclid: null,
    referrer: referrer || null,
    referrer_type: classifyReferrer(referrer, params),
    landing_url: location.href,
  };
}

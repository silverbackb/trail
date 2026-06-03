export type ChannelType = string;

export interface Channel {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
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
  // Google Ads click IDs take priority over everything, including utm_source
  if (params.get("gclid") || params.get("gbraid") || params.get("wbraid") || params.get("gad_campaignid")) return "google_ads";

  const source = params.get("utm_source");
  if (source) return source;

  // Other ad network click IDs are fallback when no utm_source
  if (params.get("fbclid")) return "facebook_ads";
  if (params.get("li_fat_id")) return "linkedin_ads";
  if (params.get("ttclid")) return "tiktok_ads";

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

const SS_KEY = "trail_channel";
const LS_KEY = "trail_channel_ls";
const LS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredChannel { ch: Channel; exp: number; }

function saveChannel(ch: Channel): void {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(ch)); } catch {}
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ch, exp: Date.now() + LS_TTL_MS } as StoredChannel));
  } catch {}
}

function loadChannel(): Channel | null {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (raw) return JSON.parse(raw) as Channel;
  } catch {}
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredChannel;
    if (Date.now() > stored.exp) { localStorage.removeItem(LS_KEY); return null; }
    return stored.ch;
  } catch { return null; }
}

export function captureChannel(): Channel {
  const params = new URLSearchParams(location.search);
  const referrer = document.referrer;
  const hasSignal = !!(
    params.get("utm_source") || params.get("gclid") || params.get("gbraid") ||
    params.get("wbraid") || params.get("gad_campaignid") ||
    params.get("fbclid") || params.get("li_fat_id") || params.get("ttclid")
  );

  if (hasSignal) {
    const ch: Channel = {
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_term: params.get("utm_term"),
      utm_content: params.get("utm_content"),
      gclid: params.get("gclid"),
      gbraid: params.get("gbraid"),
      wbraid: params.get("wbraid"),
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
    gbraid: null,
    wbraid: null,
    fbclid: null,
    li_fat_id: null,
    ttclid: null,
    referrer: referrer || null,
    referrer_type: classifyReferrer(referrer, params),
    landing_url: location.href,
  };
}

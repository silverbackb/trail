import { getCookie, setCookie } from "./cookie.js";

const COOKIE_VID = "trail_vid";
const COOKIE_SESS = "trail_vsess";
const SESSION_MINUTES = 30;

export function getOrCreateVisitorId(): string {
  let vid = getCookie(COOKIE_VID);
  if (!vid) {
    vid = crypto.randomUUID();
    setCookie(COOKIE_VID, vid, 365);
  }
  return vid;
}

export function isNewSession(): boolean {
  if (getCookie(COOKIE_SESS)) return false;
  setCookie(COOKIE_SESS, "1", SESSION_MINUTES / 1440);
  return true;
}

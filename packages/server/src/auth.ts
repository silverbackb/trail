import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const VALIDATE_URL = process.env.SILVERBACKBASE_URL
  ? `${process.env.SILVERBACKBASE_URL}/api/tokens/validate`
  : null;

const TRAIL_SECRET = process.env.TRAIL_VALIDATE_SECRET ?? "";

type CacheEntry = { valid: boolean; expires: number };
const cache = new Map<string, CacheEntry>();

async function validateToken(token: string): Promise<boolean> {
  // Cloud mode: validate against silverbackbase.com
  if (VALIDATE_URL) {
    const hash = createHash("sha256").update(token).digest("hex");

    const cached = cache.get(hash);
    if (cached && cached.expires > Date.now()) return cached.valid;

    try {
      const res = await fetch(VALIDATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trail-secret": TRAIL_SECRET },
        body: JSON.stringify({ hash }),
      });
      const data = await res.json() as { valid: boolean };
      cache.set(hash, { valid: data.valid, expires: Date.now() + 60_000 });
      return data.valid;
    } catch {
      return false;
    }
  }

  // Self-host / dev: no auth
  return true;
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized — provide Authorization: Bearer <token>" }, 401);
  }

  const token = auth.slice(7).trim();
  const valid = await validateToken(token);

  if (!valid) return c.json({ error: "Invalid or revoked token" }, 401);

  await next();
};

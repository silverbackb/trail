import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const VALIDATE_URL = process.env.SILVERBACKBASE_URL
  ? `${process.env.SILVERBACKBASE_URL}/api/tokens/validate`
  : null;

const TRAIL_SECRET = process.env.TRAIL_VALIDATE_SECRET ?? "";

type CacheEntry = { valid: boolean; workspaceId: string | null; expires: number };
const cache = new Map<string, CacheEntry>();

async function validateToken(token: string): Promise<{ valid: boolean; workspaceId: string | null }> {
  // Cloud mode: validate against silverbackbase.com
  if (VALIDATE_URL) {
    const hash = createHash("sha256").update(token).digest("hex");

    const cached = cache.get(hash);
    if (cached && cached.expires > Date.now()) {
      return { valid: cached.valid, workspaceId: cached.workspaceId };
    }

    try {
      const res = await fetch(VALIDATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trail-secret": TRAIL_SECRET },
        body: JSON.stringify({ hash }),
      });
      const data = await res.json() as { valid: boolean; workspaceId?: string | null };
      const valid = !!data.valid;
      const workspaceId = data.workspaceId ?? null;
      cache.set(hash, { valid, workspaceId, expires: Date.now() + 60_000 });
      return { valid, workspaceId };
    } catch {
      return { valid: false, workspaceId: null };
    }
  }

  // Self-host / dev: no auth
  return { valid: true, workspaceId: null };
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized — provide Authorization: Bearer <token>" }, 401);
  }

  const token = auth.slice(7).trim();
  const { valid, workspaceId } = await validateToken(token);

  if (!valid) return c.json({ error: "Invalid or revoked token" }, 401);

  // Attach workspaceId to context for downstream tenant isolation
  c.set("workspaceId", workspaceId);

  await next();
};

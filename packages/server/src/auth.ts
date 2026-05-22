import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const VALIDATE_URL = process.env.SILVERBACKBASE_URL
  ? `${process.env.SILVERBACKBASE_URL}/api/tokens/validate`
  : null;

const TRAIL_SECRET = process.env.TRAIL_VALIDATE_SECRET ?? "";
const INTERNAL_SECRET = process.env.TRAIL_INTERNAL_SECRET ?? "";

type CacheEntry = { valid: boolean; workspaceId: string | null; expires: number; isAdmin?: boolean };
const cache = new Map<string, CacheEntry>();

async function validateToken(token: string): Promise<{ valid: boolean; workspaceId: string | null; isAdmin?: boolean }> {
  // Cloud mode: validate against silverbackbase.com
  if (VALIDATE_URL) {
    const hash = createHash("sha256").update(token).digest("hex");

    const cached = cache.get(hash);
    if (cached && cached.expires > Date.now()) {
      return { valid: cached.valid, workspaceId: cached.workspaceId, isAdmin: cached.isAdmin };
    }

    try {
      const res = await fetch(VALIDATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trail-secret": TRAIL_SECRET },
        body: JSON.stringify({ hash }),
      });
      const data = await res.json() as { valid: boolean; workspaceId?: string | null; isAdmin?: boolean };
      const valid = !!data.valid;
      const workspaceId = data.workspaceId ?? null;
      const isAdmin = !!data.isAdmin;
      cache.set(hash, { valid, workspaceId, expires: Date.now() + 60_000, isAdmin });
      return { valid, workspaceId, isAdmin };
    } catch {
      return { valid: false, workspaceId: null, isAdmin: false };
    }
  }

  // Self-host / dev: no auth
  return { valid: true, workspaceId: null, isAdmin: false };
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  // Fast-path: internal service-to-service call from silverbackbase-mcp
  if (INTERNAL_SECRET) {
    const internalSecret = c.req.header("x-internal-secret");
    if (internalSecret === INTERNAL_SECRET) {
      c.set("workspaceId", c.req.header("x-workspace-id") ?? null);
      await next();
      return;
    }
  }

  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized — provide Authorization: Bearer <token>" }, 401);
  }

  const token = auth.slice(7).trim();
  const { valid, workspaceId, isAdmin } = await validateToken(token);

  if (!valid) return c.json({ error: "Invalid or revoked token" }, 401);

  // If this is the admin token, check if there is a header override
  let effectiveWorkspaceId = workspaceId;
  if (isAdmin) {
    const headerWorkspaceId = c.req.header("x-workspace-id");
    if (headerWorkspaceId) {
      effectiveWorkspaceId = headerWorkspaceId;
    }
  }

  // Attach workspaceId to context for downstream tenant isolation
  c.set("workspaceId", effectiveWorkspaceId);

  await next();
};

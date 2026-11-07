import type { FastifyReply, FastifyRequest } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Dev servers pick a free port (Astro moved 4322 → 4323), so outside production any local port passes.
function isLocalOrigin(origin: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * CSRF guard. SameSite=Strict already keeps the cookie off cross-site requests;
 * this is the second lock for browsers that ignore it. A missing Origin is
 * refused too: every browser sends one on a non-GET fetch, so its absence means
 * a non-browser client or a stripped header — neither should change state.
 */
export function originGuard(appOrigins: readonly string[], allowLocalhost: boolean) {
  const allowed = new Set(appOrigins);
  return async function checkOrigin(request: FastifyRequest, reply: FastifyReply) {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin === undefined || !(allowed.has(origin) || (allowLocalhost && isLocalOrigin(origin)))) {
      return reply.status(403).send({ code: "forbidden_origin" });
    }
  };
}

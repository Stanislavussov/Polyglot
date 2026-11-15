import type { FastifyReply, FastifyRequest } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard. SameSite=Strict already keeps the cookie off cross-site requests;
 * this is the second lock for browsers that ignore it. A missing Origin is
 * refused too: every browser sends one on a non-GET fetch, so its absence means
 * a non-browser client or a stripped header — neither should change state.
 */
export function originGuard(appOrigin: string, serverToServerPaths: ReadonlySet<string> = new Set()) {
  return async function checkOrigin(request: FastifyRequest, reply: FastifyReply) {
    if (SAFE_METHODS.has(request.method)) return;
    // A payment provider's notification carries no Origin and no cookie; it changes
    // nothing on its own word — the handler re-fetches the charge from the provider.
    if (serverToServerPaths.has(request.url.split("?")[0] ?? "")) return;
    if (request.headers.origin !== appOrigin) {
      return reply.status(403).send({ code: "forbidden_origin" });
    }
  };
}

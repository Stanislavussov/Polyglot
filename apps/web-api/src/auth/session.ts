import type { User } from "@polyglot/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { WebServices } from "../services.js";
import { sessionToken } from "./session-cookie.js";

declare module "fastify" {
  interface FastifyRequest {
    learner: User;
  }
}

export interface SessionClaims {
  sub: number;
}

const PUBLIC_PATHS = new Set(["/livez", "/api/auth/config", "/api/auth/telegram", "/api/auth/dev", "/api/auth/logout"]);

/**
 * Every /api request outside the login routes needs a signed session AND a live
 * user row. The token carries only the user id: plan, role and credits are read
 * from the row on each request, so a plan change or a deactivation takes effect
 * immediately instead of when the 7-day token expires.
 */
export function installSessionGuard(app: FastifyInstance, services: WebServices, production: boolean): void {
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split("?")[0] ?? "";
    if (!path.startsWith("/api/") || PUBLIC_PATHS.has(path)) return;

    const token = sessionToken(request, production);
    if (!token) return reply.status(401).send({ code: "unauthorized" });
    let claims: SessionClaims;
    try {
      claims = app.jwt.verify<SessionClaims>(token);
    } catch {
      return reply.status(401).send({ code: "unauthorized" });
    }
    const user = await services.userRepository.findById(claims.sub);
    if (!user?.isActive) return reply.status(401).send({ code: "unauthorized" });
    request.learner = user;
  });
}

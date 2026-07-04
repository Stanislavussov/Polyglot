import fastifyJwt from "@fastify/jwt";
import { adminUserRepository } from "@polyglot/adapter-db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    adminUser: { adminId: number; email: string; role: string };
  }
}

/**
 * How long an admin's `isActive` state is trusted before it is re-checked
 * against the DB. Short enough that a deactivated admin loses access quickly
 * (well before the 24h token TTL), long enough that a burst of requests does
 * not hit the DB on every call.
 */
export const ADMIN_ACTIVE_CACHE_TTL_MS = 30_000;

const activeCache = new Map<number, { isActive: boolean; expiresAt: number }>();

/** Clear the runtime active-admin cache. Exposed for test isolation. */
export function clearAdminActiveCache(): void {
  activeCache.clear();
}

/**
 * Runtime revocation check (Fable T06): resolve an admin's current `isActive`
 * flag, backed by a short in-memory cache so validly-signed tokens do not hit
 * the DB on every request. A deleted admin resolves to inactive.
 */
async function isAdminActive(adminId: number): Promise<boolean> {
  const now = Date.now();
  const cached = activeCache.get(adminId);
  if (cached && cached.expiresAt > now) {
    return cached.isActive;
  }
  const admin = await adminUserRepository.findById(adminId);
  const isActive = admin?.isActive ?? false;
  activeCache.set(adminId, { isActive, expiresAt: now + ADMIN_ACTIVE_CACHE_TTL_MS });
  return isActive;
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }

  await app.register(fastifyJwt, {
    secret,
    // Runs on every jwtVerify() after the signature checks out: a deactivated or
    // deleted admin is rejected (401) here instead of keeping full access until
    // the token expires. This closes finding S4 across all routes at one point.
    trusted: async (_request, decodedToken) => {
      const adminId = (decodedToken as { adminId?: number }).adminId;
      if (typeof adminId !== "number") {
        return false;
      }
      return isAdminActive(adminId);
    },
  });

  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = await request.jwtVerify<{
        adminId: number;
        email: string;
        role: string;
      }>();
      request.adminUser = user;
    } catch {
      reply.status(401).send({ error: "Unauthorized" });
    }
  });
});

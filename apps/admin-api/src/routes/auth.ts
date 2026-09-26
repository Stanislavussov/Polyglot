import { adminUserRepository } from "@polyglot/adapter-db";
import { loginSchema } from "@polyglot/admin-contracts";
import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { clearedSessionCookie, SESSION_TTL_SECONDS, sessionCookie } from "../session-cookie.js";

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/login",
    {
      // Hard anti-bruteforce limit on the public login endpoint: at most 5
      // attempts/min per client IP. Tighter than the soft global limit.
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = loginSchema.parse(request.body);
      const admin = await adminUserRepository.findByEmail(body.email);

      if (!admin?.isActive) {
        // Log the attempt (email + IP) for brute-force alerting — never the password.
        request.log.warn({ email: body.email, ip: request.ip }, "Failed admin login: unknown or inactive account");
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      const valid = await bcrypt.compare(body.password, admin.passwordHash);
      if (!valid) {
        request.log.warn({ email: body.email, ip: request.ip }, "Failed admin login: incorrect password");
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      const token = app.jwt.sign(
        { adminId: admin.id, email: admin.email, role: admin.role },
        {
          expiresIn: SESSION_TTL_SECONDS,
        },
      );

      await adminUserRepository.updateLastLogin(admin.id);

      reply.header("set-cookie", sessionCookie(token));

      return { token, admin: { id: admin.id, email: admin.email, role: admin.role } };
    },
  );

  app.post("/logout", async (_request: FastifyRequest, reply: FastifyReply) => {
    // A stateless JWT cannot be revoked here; dropping the cookie is what ends
    // the browser session.
    return reply.header("set-cookie", clearedSessionCookie()).status(204).send();
  });

  app.get("/me", async (request: FastifyRequest, reply: FastifyReply) => {
    // Auth is enforced globally by the unified hook (plugins/auth.ts), which has
    // already verified the token and populated request.adminUser.
    const admin = await adminUserRepository.findById(request.adminUser.adminId);
    if (!admin) {
      return reply.status(404).send({ error: "Admin not found" });
    }
    return { id: admin.id, email: admin.email, role: admin.role };
  });
}

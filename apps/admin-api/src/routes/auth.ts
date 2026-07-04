import { adminUserRepository } from "@polyglot/adapter-db";
import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

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

      const token = app.jwt.sign({ adminId: admin.id, email: admin.email, role: admin.role }, { expiresIn: "24h" });

      await adminUserRepository.updateLastLogin(admin.id);

      return { token, admin: { id: admin.id, email: admin.email, role: admin.role } };
    },
  );

  app.get("/me", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await request.jwtVerify<{ adminId: number; email: string; role: string }>();
    const admin = await adminUserRepository.findById(user.adminId);
    if (!admin) {
      return reply.status(404).send({ error: "Admin not found" });
    }
    return { id: admin.id, email: admin.email, role: admin.role };
  });
}

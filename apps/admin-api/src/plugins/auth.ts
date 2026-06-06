import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    adminUser: { adminId: number; email: string; role: string };
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }

  await app.register(fastifyJwt, { secret });

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

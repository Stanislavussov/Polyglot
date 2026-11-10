import type { User } from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import type { WebServices } from "../services.js";

export async function toMe(services: WebServices, user: User) {
  const settings = await services.userRepository.getSettings(user.id);
  return {
    id: user.id,
    username: user.username,
    plan: user.subscriptionPlan,
    onboarded: user.onboarded,
    interfaceLang: settings?.interfaceLang ?? "en",
  };
}

export function meRoutes(app: FastifyInstance, services: WebServices): void {
  app.get("/api/me", async (request) => toMe(services, request.learner));
}

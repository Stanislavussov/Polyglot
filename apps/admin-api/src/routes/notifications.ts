import { systemSettingsRepository } from "@polyglot/adapter-db";
import { notificationSettingsSchema } from "@polyglot/admin-contracts";
import { FALLBACK_NOTIFICATIONS, type NotificationDefaults } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", async () => {
    const value = await systemSettingsRepository.get<NotificationDefaults>("notifications");
    return value ?? FALLBACK_NOTIFICATIONS;
  });

  app.put("/notifications", async (request: FastifyRequest) => {
    const body = notificationSettingsSchema.parse(request.body);
    await systemSettingsRepository.set("notifications", body);
    return body;
  });
}

import { systemSettingsRepository } from "@polyglot/adapter-db";
import type { NotificationDefaults } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const defaultsSchema = z.object({
  defaultTime: z.string().regex(/^\d{2}:\d{2}$/),
  defaultType: z.enum(["suggested", "srs", "contextual"]),
  inactivityDays: z.number().int().min(1),
  notificationTimesLimit: z.number().int().min(1).max(48).default(12),
});

const DEFAULTS: NotificationDefaults = {
  defaultTime: "08:00",
  defaultType: "srs",
  inactivityDays: 14,
  notificationTimesLimit: 12,
};

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    await request.jwtVerify();
  });

  app.get("/notifications", async () => {
    const value = await systemSettingsRepository.get<NotificationDefaults>("notifications");
    return value ?? DEFAULTS;
  });

  app.put("/notifications", async (request: FastifyRequest) => {
    const body = defaultsSchema.parse(request.body);
    await systemSettingsRepository.set("notifications", body);
    return body;
  });
}

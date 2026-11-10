import { logEvent } from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { readSettings } from "./settings.js";

/**
 * The browsers' push services. The bot later POSTs to whatever endpoint is stored,
 * so an arbitrary URL here would let any learner aim the bot at an internal host.
 */
const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.port === "" && PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname));
}

const base64Url = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+=*$/);

const subscribeSchema = z
  .object({
    endpoint: z.string().max(2048).refine(isPushServiceEndpoint),
    keys: z.object({ p256dh: base64Url, auth: base64Url }),
    /** Sent by the app shell's own switch, not by a tap in Settings. */
    auto: z.boolean().optional(),
  })
  .strict();

const unsubscribeSchema = z.object({ endpoint: z.string().max(2048) }).strict();

export function pushRoutes(app: FastifyInstance, services: WebServices, vapidPublicKey: string | null): void {
  app.post("/api/push/subscribe", async (request, reply) => {
    if (!vapidPublicKey) return reply.status(503).send({ code: "push_unavailable" });
    const parsed = subscribeSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_subscription" });
    const userId = request.learner.id;
    const { endpoint, keys, auto } = parsed.data;
    await services.pushSubscriptionRepository.upsert({
      userId,
      endpoint,
      keys,
      userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
    });

    // The owner's rule: an installed app takes over reminders the learner already
    // gets. Someone who turned them off is not opted back in by installing.
    if (auto) {
      const settings = await services.userRepository.getSettings(userId);
      if (settings?.notificationEnabled && settings.notificationChannel !== "web") {
        await services.notificationRepository.updatePrefs(userId, { notificationChannel: "web" });
        logEvent("settings.notification_channel_changed", { to: "web", via: "auto" });
      }
    }
    return readSettings(services, userId, vapidPublicKey);
  });

  app.post("/api/push/unsubscribe", async (request, reply) => {
    const parsed = unsubscribeSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_subscription" });
    const userId = request.learner.id;
    await services.pushSubscriptionRepository.removeForUser(userId, parsed.data.endpoint);
    if ((await services.pushSubscriptionRepository.countForUser(userId)) === 0) {
      const settings = await services.userRepository.getSettings(userId);
      if (settings?.notificationChannel === "web") {
        await services.notificationRepository.updatePrefs(userId, { notificationChannel: "bot" });
      }
    }
    return readSettings(services, userId, vapidPublicKey);
  });
}

import { logEvent, type User } from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { clearedSessionCookie, sessionCookie } from "../auth/session-cookie.js";
import { telegramLoginSchema, verifyTelegramLogin } from "../auth/telegram-hash.js";
import type { WebApiConfig } from "../config.js";
import type { WebServices } from "../services.js";
import { toMe } from "./me.js";

/**
 * The same telegram → user resolution the bot's auth middleware runs, so a web
 * login lands on the bot user's row. `create` is an idempotent get-or-create on
 * telegram_id; a brand-new user starts not onboarded, exactly as after /start.
 */
async function resolveLearner(services: WebServices, telegramId: number, username: string | null): Promise<User> {
  const externalId = String(telegramId);
  const userId = await services.identityRepository.resolveUserId("telegram", externalId);
  const existing = userId !== null ? await services.userRepository.findById(userId) : null;
  if (existing) return existing;
  const user = await services.userRepository.create({ telegramId, username });
  await services.identityRepository.linkIdentity(user.id, "telegram", externalId);
  logEvent("user.identity_linked", { userId: user.id, onboarded: user.onboarded, channel: "web" });
  return user;
}

export function authRoutes(
  app: FastifyInstance,
  services: WebServices,
  config: Pick<WebApiConfig, "botToken" | "botUsername" | "production" | "devUserId">,
  now: () => number = () => Math.floor(Date.now() / 1000),
): void {
  // The bot id is the token's public half (before ":"), never the secret part.
  const botId = Number(config.botToken.split(":")[0]);
  app.get("/api/auth/config", async () => ({
    botUsername: config.botUsername,
    botId,
    devLogin: config.devUserId !== null,
  }));

  const devUserId = config.devUserId;
  if (devUserId !== null) {
    // Registered only outside production (see loadConfig): local runs cannot
    // use the Telegram widget, which refuses localhost as a bot domain.
    app.post("/api/auth/dev", async (_request, reply) => {
      const user = await services.userRepository.findById(devUserId);
      if (!user?.isActive) return reply.status(401).send({ code: "invalid_login" });
      reply.header("set-cookie", sessionCookie(app.jwt.sign({ sub: user.id }), config.production));
      return toMe(services, user);
    });
  }

  app.post(
    "/api/auth/telegram",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = telegramLoginSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(401).send({ code: "invalid_login" });
      const check = verifyTelegramLogin(parsed.data, config.botToken, now());
      if (!check.ok) {
        logEvent("web.login_rejected", { reason: check.reason }, "warn");
        return reply.status(401).send({ code: "invalid_login" });
      }

      const user = await resolveLearner(services, parsed.data.id, parsed.data.username ?? null);
      if (!user.isActive) return reply.status(401).send({ code: "invalid_login" });

      const token = app.jwt.sign({ sub: user.id });
      reply.header("set-cookie", sessionCookie(token, config.production));
      logEvent("web.login", { userId: user.id, onboarded: user.onboarded });
      return toMe(services, user);
    },
  );

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.header("set-cookie", clearedSessionCookie(config.production));
    return reply.status(204).send();
  });
}

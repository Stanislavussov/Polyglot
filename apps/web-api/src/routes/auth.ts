import { createAccounts, logEvent, TELEGRAM_CHANNEL, type VerifiedLogin } from "@polyglot/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { clearedSessionCookie, sessionCookie } from "../auth/session-cookie.js";
import { telegramLoginSchema, verifyTelegramLogin } from "../auth/telegram-hash.js";
import type { WebApiConfig } from "../config.js";
import type { WebServices } from "../services.js";
import { toMe } from "./me.js";

const googleBody = z.object({ credential: z.string().min(1).max(4096) });

export function authRoutes(
  app: FastifyInstance,
  services: WebServices,
  config: Pick<WebApiConfig, "botToken" | "production" | "devUserId" | "googleClientId">,
  now: () => number = () => Math.floor(Date.now() / 1000),
): void {
  // The bot id is the token's public half (before ":"), never the secret part.
  const botId = Number(config.botToken.split(":")[0]);
  // The same rule the bot's auth middleware follows: a web login lands on the bot user's row.
  const accounts = createAccounts({ identities: services.identityRepository, users: services.userRepository });

  app.get("/api/auth/config", async () => ({
    botId,
    devLogin: config.devUserId !== null,
    googleClientId: services.googleLogin ? config.googleClientId : null,
  }));

  /** The Telegram widget payload, checked; the reply is already sent when this returns null. */
  async function checkTelegram(request: FastifyRequest, reply: FastifyReply): Promise<VerifiedLogin | null> {
    const parsed = telegramLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.status(401).send({ code: "invalid_login" });
      return null;
    }
    const check = verifyTelegramLogin(parsed.data, config.botToken, now());
    if (!check.ok) {
      logEvent("web.login_rejected", { reason: check.reason }, "warn");
      await reply.status(401).send({ code: "invalid_login" });
      return null;
    }
    return { channel: TELEGRAM_CHANNEL, externalId: String(parsed.data.id), username: parsed.data.username ?? null };
  }

  async function checkGoogle(request: FastifyRequest, reply: FastifyReply): Promise<VerifiedLogin | null> {
    const parsed = googleBody.safeParse(request.body);
    const login =
      parsed.success && services.googleLogin ? await services.googleLogin.verify(parsed.data.credential) : null;
    if (!login) {
      logEvent("web.login_rejected", { reason: "google" }, "warn");
      await reply.status(401).send({ code: "invalid_login" });
    }
    return login;
  }

  async function startSession(reply: FastifyReply, login: VerifiedLogin) {
    const { user, created } = await accounts.signIn(login);
    if (created) logEvent("user.identity_linked", { userId: user.id, onboarded: false, channel: login.channel });
    if (!user.isActive) return reply.status(401).send({ code: "invalid_login" });
    reply.header("set-cookie", sessionCookie(app.jwt.sign({ sub: user.id }), config.production));
    logEvent("web.login", { userId: user.id, onboarded: user.onboarded, method: login.channel });
    return toMe(services, user);
  }

  const loginLimit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

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

  app.post("/api/auth/telegram", loginLimit, async (request, reply) => {
    const login = await checkTelegram(request, reply);
    return login ? startSession(reply, login) : reply;
  });

  app.post("/api/auth/google", loginLimit, async (request, reply) => {
    const login = await checkGoogle(request, reply);
    return login ? startSession(reply, login) : reply;
  });

  // Adding a method to the signed-in account. Two existing accounts are never merged.
  app.get("/api/auth/methods", async (request) => ({
    methods: await accounts.listMethods(request.learner.id),
  }));

  for (const [method, check] of [
    ["telegram", checkTelegram],
    ["google", checkGoogle],
  ] as const) {
    app.post(`/api/auth/link/${method}`, loginLimit, async (request, reply) => {
      const login = await check(request, reply);
      if (!login) return reply;
      const outcome = await accounts.link(request.learner.id, login);
      logEvent("web.method_linked", { userId: request.learner.id, method, outcome });
      if (outcome === "taken" || outcome === "channel_taken") return reply.status(409).send({ code: outcome });
      return { methods: await accounts.listMethods(request.learner.id) };
    });
  }

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.header("set-cookie", clearedSessionCookie(config.production));
    return reply.status(204).send();
  });
}

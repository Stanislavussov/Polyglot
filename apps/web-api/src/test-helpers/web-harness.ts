import { createHash, createHmac } from "node:crypto";
import { articleVocabularyRepository, pushSubscriptionRepository } from "@polyglot/adapter-db";
import type { FastifyInstance } from "fastify";
import {
  type BotHarness,
  createBotHarness,
  type HarnessOptions,
} from "../../../bot/src/test-helpers/integration/bot-harness.js";
import { buildWebApiApp } from "../app.js";
import type { WebApiConfig } from "../config.js";

export const WEB_ORIGIN = "http://learn.test";
const BOT_TOKEN = "424242:web-harness-token";
const NOW = 1_800_000_000;
export const HARNESS_VAPID_PUBLIC_KEY = "harness-vapid-public-key";

/**
 * The web app and the bot over ONE service container: the bot harness's real
 * repositories against the lane's Postgres, its settings and its AI mock. A
 * parity assertion then compares two channels, not two configurations.
 */
export interface WebHarness {
  bot: BotHarness;
  app: FastifyInstance;
  /** Signs a Telegram Login Widget payload and posts it; returns the session cookie. */
  login(telegramId: number, username?: string): Promise<{ cookie: string; status: number; body: unknown }>;
  call(
    cookie: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
  ): Promise<{ status: number; body: unknown }>;
}

export function signTelegramLogin(fields: Record<string, string | number>, token = BOT_TOKEN) {
  const dcs = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const key = createHash("sha256").update(token).digest();
  return { ...fields, hash: createHmac("sha256", key).update(dcs).digest("hex") };
}

export async function createWebHarness(options: HarnessOptions = {}): Promise<WebHarness> {
  const bot = createBotHarness(options);
  const config: WebApiConfig = {
    port: 0,
    host: "127.0.0.1",
    production: false,
    botToken: BOT_TOKEN,
    jwtSecret: "integration-test-secret-integration-test",
    appOrigin: WEB_ORIGIN,
    staticDir: null,
    devUserId: null,
    botUsername: "harness_bot",
    vapidPublicKey: HARNESS_VAPID_PUBLIC_KEY,
  };
  // The same object, not a spread copy: tests swap services on `web.bot.services` after start.
  const services = Object.assign(bot.services, { pushSubscriptionRepository, articleVocabularyRepository });
  const app = await buildWebApiApp(services, config, { now: () => NOW });

  const call: WebHarness["call"] = async (cookie, method, url, payload) => {
    const res = await app.inject({
      method,
      url,
      headers: { cookie, origin: WEB_ORIGIN },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  };

  const login: WebHarness["login"] = async (telegramId, username = "learner") => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      headers: { origin: WEB_ORIGIN },
      payload: signTelegramLogin({ id: telegramId, first_name: "Web", username, auth_date: NOW - 5 }),
    });
    const cookie = String(res.headers["set-cookie"] ?? "").split(";")[0] ?? "";
    return { cookie, status: res.statusCode, body: res.json() };
  };

  return { bot, app, login, call };
}

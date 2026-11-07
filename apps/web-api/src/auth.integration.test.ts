/**
 * AC 1 — Telegram Login on the web opens a session on the bot user's row, and
 * creates (not onboarded) a user the bot has never seen.
 */
import { getDb, userRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { messageUpdate } from "../../bot/src/test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { createWebHarness, WEB_ORIGIN } from "./test-helpers/web-harness.js";

describe("web login (Telegram)", () => {
  it("opens a session on the user the bot already knows", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    // The bot sees the user first: its auth middleware links the telegram identity.
    const userId = await arrangeOnboardedTranslator(telegramId);
    await web.bot.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/help" }));

    const { cookie, status, body } = await web.login(telegramId);

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: userId, onboarded: true });
    expect((await web.call(cookie, "GET", "/api/me")).body).toMatchObject({ id: userId });
  });

  it("creates a new, not-yet-onboarded user the bot then recognises", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();

    const { body } = await web.login(telegramId);
    const webUserId = (body as { id: number }).id;

    expect(body).toMatchObject({ onboarded: false });
    const user = await userRepository.findById(webUserId);
    expect(user?.onboarded).toBe(false);
    // Same row for the bot: its middleware resolves the identity the web linked.
    await web.bot.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/start" }));
    const resolved = await web.bot.services.identityRepository.resolveUserId("telegram", String(telegramId));
    expect(resolved).toBe(webUserId);
  });

  it("rejects a forged login and requests without a session", async () => {
    const web = await createWebHarness();
    const forged = await web.app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      headers: { origin: WEB_ORIGIN },
      payload: { id: 1, auth_date: 1_800_000_000, hash: "0".repeat(64) },
    });
    expect(forged.statusCode).toBe(401);
    expect((await web.call("", "GET", "/api/me")).status).toBe(401);
  });

  it("drops the session of a deactivated user on the next request", async () => {
    const web = await createWebHarness();
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId);
    const { cookie } = await web.login(telegramId);
    await getDb().$client`update users set is_active = false where id = ${userId}`;

    expect((await web.call(cookie, "GET", "/api/me")).status).toBe(401);
  });
});

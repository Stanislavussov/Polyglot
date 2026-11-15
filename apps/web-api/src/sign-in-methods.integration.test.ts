/**
 * @business Signing in with Google, and adding Telegram to the same account (real Postgres).
 *
 * Spec:
 * - Google sign-in creates an account with no Telegram chat id; signing in again
 *   opens the same account.
 * - Signed in with Google, the person links Telegram with the login widget. The
 *   bot then treats that Telegram user as this very account — no second row.
 * - A Telegram that already has its own account is refused (409) and nothing is
 *   merged: both accounts stay as they were.
 */
import { identityRepository, userRepository } from "@polyglot/adapter-db";
import type { LoginVerifier } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { messageUpdate } from "../../bot/src/test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { createWebHarness, signTelegramLogin, WEB_ORIGIN } from "./test-helpers/web-harness.js";

const NOW = 1_800_000_000;

/** Google at its boundary: a credential "google:<sub>" is a valid token for that account. */
const fakeGoogle: LoginVerifier = {
  channel: "google",
  async verify(credential) {
    return credential.startsWith("google:") ? { channel: "google", externalId: credential.slice(7) } : null;
  },
};

async function harness() {
  const web = await createWebHarness();
  Object.assign(web.bot.services, { googleLogin: fakeGoogle });
  const googleLogin = async (sub: string) => {
    const res = await web.app.inject({
      method: "POST",
      url: "/api/auth/google",
      headers: { origin: WEB_ORIGIN },
      payload: { credential: `google:${sub}` },
    });
    return {
      status: res.statusCode,
      cookie: String(res.headers["set-cookie"] ?? "").split(";")[0] ?? "",
      body: res.json(),
    };
  };
  const widget = (telegramId: number) =>
    signTelegramLogin({ id: telegramId, first_name: "Web", username: "learner", auth_date: NOW - 5 });
  return { web, googleLogin, widget };
}

describe("sign-in methods (integration)", () => {
  it("signs up with Google, links Telegram, and the bot sees the same account", async () => {
    // Arrange
    const { web, googleLogin, widget } = await harness();
    const sub = `g-${uniqueTelegramId()}`;
    const telegramId = uniqueTelegramId();

    // Act — first Google sign-in, then again
    const first = await googleLogin(sub);
    const again = await googleLogin(sub);

    // Assert — one account, no Telegram yet
    expect(first.status).toBe(200);
    const userId = (first.body as { id: number }).id;
    expect((again.body as { id: number }).id).toBe(userId);
    expect(await userRepository.getTelegramIdById(userId)).toBeNull();
    expect((await web.call(first.cookie, "GET", "/api/auth/methods")).body).toEqual({ methods: ["google"] });

    // Act — link Telegram from settings
    const linked = await web.call(first.cookie, "POST", "/api/auth/link/telegram", widget(telegramId));

    // Assert — both methods, and the chat id the bot delivers to
    expect(linked).toEqual({ status: 200, body: { methods: ["google", "telegram"] } });
    expect(await userRepository.getTelegramIdById(userId)).toBe(telegramId);

    // Act — that Telegram user writes to the bot
    await web.bot.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/start" }));

    // Assert — the bot resolved the same account and created no second one
    expect(await identityRepository.resolveUserId("telegram", String(telegramId))).toBe(userId);
    expect(await userRepository.findIdByTelegramId(telegramId)).toBe(userId);
    expect(web.bot.sent.some((call) => call.payload.chat_id === telegramId)).toBe(true);
  });

  it("refuses to add a Telegram that already has its own account, and merges nothing", async () => {
    // Arrange — a bot user, and a separate Google account
    const { web, googleLogin, widget } = await harness();
    const telegramId = uniqueTelegramId();
    const telegramUser = (await web.login(telegramId)).body as { id: number };
    const google = await googleLogin(`g-${uniqueTelegramId()}`);
    const googleUserId = (google.body as { id: number }).id;

    // Act
    const refused = await web.call(google.cookie, "POST", "/api/auth/link/telegram", widget(telegramId));

    // Assert — 409, and each method still opens its own account
    expect(refused).toEqual({ status: 409, body: { code: "taken" } });
    expect(await identityRepository.resolveUserId("telegram", String(telegramId))).toBe(telegramUser.id);
    expect(await userRepository.getTelegramIdById(googleUserId)).toBeNull();
    expect((await web.call(google.cookie, "GET", "/api/auth/methods")).body).toEqual({ methods: ["google"] });
  });

  it("refuses a forged Google credential", async () => {
    const { web } = await harness();
    const forged = await web.app.inject({
      method: "POST",
      url: "/api/auth/google",
      headers: { origin: WEB_ORIGIN },
      payload: { credential: "forged" },
    });
    expect(forged.statusCode).toBe(401);
  });
});

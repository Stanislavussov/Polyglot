/**
 * Web Push sign-up — the installed app's subscription and the delivery channel the
 * bot's scheduler reads next (`getSettings(userId).notificationChannel`).
 */
import { pushSubscriptionRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { createWebHarness, HARNESS_VAPID_PUBLIC_KEY } from "./test-helpers/web-harness.js";

const KEYS = {
  p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
  auth: "tBHItJI5svbpez7KI4CCXg",
};

function endpointFor(telegramId: number): string {
  return `https://fcm.googleapis.com/fcm/send/test-${telegramId}`;
}

async function arrange(options: { notificationsOn: boolean }) {
  const web = await createWebHarness();
  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
  await web.bot.services.notificationRepository.updatePrefs(userId, { notificationEnabled: options.notificationsOn });
  const { cookie } = await web.login(telegramId);
  return { web, telegramId, userId, cookie };
}

describe("web push", () => {
  it("hands the browser the public key and the current channel", async () => {
    const { web, cookie } = await arrange({ notificationsOn: true });

    const res = await web.call(cookie, "GET", "/api/settings");

    expect(res.body).toMatchObject({ notifications: { channel: "bot", pushPublicKey: HARNESS_VAPID_PUBLIC_KEY } });
  });

  it("moves reminders a learner already gets to the installed app", async () => {
    const { web, telegramId, userId, cookie } = await arrange({ notificationsOn: true });

    const res = await web.call(cookie, "POST", "/api/push/subscribe", {
      endpoint: endpointFor(telegramId),
      keys: KEYS,
      auto: true,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ notifications: { channel: "web" } });
    expect((await web.bot.services.userRepository.getSettings(userId))?.notificationChannel).toBe("web");
    expect(await pushSubscriptionRepository.listForUser(userId)).toEqual([
      expect.objectContaining({ endpoint: endpointFor(telegramId), keys: KEYS }),
    ]);
  });

  it("does not opt a learner who turned reminders off back in", async () => {
    const { web, telegramId, userId, cookie } = await arrange({ notificationsOn: false });

    await web.call(cookie, "POST", "/api/push/subscribe", {
      endpoint: endpointFor(telegramId),
      keys: KEYS,
      auto: true,
    });

    expect((await web.bot.services.userRepository.getSettings(userId))?.notificationChannel).toBe("bot");
    expect(await pushSubscriptionRepository.countForUser(userId)).toBe(1);
  });

  it("refuses an endpoint that is not a browser push service", async () => {
    const { web, userId, cookie } = await arrange({ notificationsOn: true });

    const res = await web.call(cookie, "POST", "/api/push/subscribe", {
      endpoint: "https://169.254.169.254/x",
      keys: KEYS,
    });

    expect(res.status).toBe(400);
    expect(await pushSubscriptionRepository.countForUser(userId)).toBe(0);
  });

  it("refuses the web channel while no app is subscribed, then accepts it", async () => {
    const { web, telegramId, userId, cookie } = await arrange({ notificationsOn: true });

    const refused = await web.call(cookie, "PATCH", "/api/settings/notifications", { channel: "web" });
    expect(refused).toMatchObject({ status: 409, body: { code: "no_push_subscription" } });

    await web.call(cookie, "POST", "/api/push/subscribe", { endpoint: endpointFor(telegramId), keys: KEYS });
    expect((await web.bot.services.userRepository.getSettings(userId))?.notificationChannel).toBe("bot");

    const accepted = await web.call(cookie, "PATCH", "/api/settings/notifications", { channel: "web" });
    expect(accepted).toMatchObject({ status: 200, body: { notifications: { channel: "web" } } });

    const back = await web.call(cookie, "PATCH", "/api/settings/notifications", { channel: "bot" });
    expect(back.body).toMatchObject({ notifications: { channel: "bot" } });
  });

  it("returns reminders to Telegram when the last app unsubscribes", async () => {
    const { web, telegramId, userId, cookie } = await arrange({ notificationsOn: true });
    await web.call(cookie, "POST", "/api/push/subscribe", {
      endpoint: endpointFor(telegramId),
      keys: KEYS,
      auto: true,
    });

    const res = await web.call(cookie, "POST", "/api/push/unsubscribe", { endpoint: endpointFor(telegramId) });

    expect(res.body).toMatchObject({ notifications: { channel: "bot" } });
    expect(await pushSubscriptionRepository.countForUser(userId)).toBe(0);
  });
});

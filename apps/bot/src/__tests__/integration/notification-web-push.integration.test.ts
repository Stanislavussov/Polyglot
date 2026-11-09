/**
 * Web Push delivery — e2e through the real `sendFn` (real repositories, real
 * Postgres, fake Telegram `fetch`) with a fake push sender standing in for the
 * browser push services, so no request leaves the process.
 *
 * Evidence per test: what reached the fake sender, what reached this test's own
 * Telegram chat, and the persisted channel / subscription rows.
 */
import {
  notificationDeliveryRepository,
  notificationRepository,
  pushSubscriptionRepository,
  userRepository,
} from "@polyglot/adapter-db";
import type { NotificationPayload } from "@polyglot/adapter-notifications";
import type { GenerateObjectFn, WebPushResult, WebPushSender } from "@polyglot/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildNotificationScheduling } from "../../notifications/notification.wiring.js";
import { arrangeNotifiableUser } from "../../test-helpers/integration/arrange.js";
import type { BotHarness, CapturedCall } from "../../test-helpers/integration/bot-harness.js";
import { createBotHarness } from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

const KEYS = { p256dh: "p256dh-key", auth: "auth-key" };

const noLiveAi: GenerateObjectFn = async () => {
  throw new Error("NO_LIVE_AI_IN_TESTS");
};

interface FakeSender extends WebPushSender {
  sent: Array<{ endpoint: string; payload: { title: string; body: string; url: string } }>;
}

function fakeSender(outcome: (endpoint: string) => WebPushResult | Error): FakeSender {
  const sent: FakeSender["sent"] = [];
  return {
    sent,
    async send(subscription, payload) {
      const result = outcome(subscription.endpoint);
      if (result instanceof Error) throw result;
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
      return result;
    },
  };
}

function messagesTo(sent: CapturedCall[], chatId: number): CapturedCall[] {
  return sent.filter(
    (call) => call.method === "sendMessage" && Number((call.payload as { chat_id?: number }).chat_id) === chatId,
  );
}

const seededUserIds: number[] = [];

afterEach(async () => {
  const ids = seededUserIds.splice(0);
  await Promise.all(ids.map((id) => notificationRepository.disableNotifications(id)));
});

async function arrangeWebUser(harness: BotHarness, endpoints: string[]) {
  const telegramId = uniqueTelegramId();
  const { userId } = await arrangeNotifiableUser(telegramId, { withVocabulary: false });
  seededUserIds.push(userId);
  for (const endpoint of endpoints) await pushSubscriptionRepository.upsert({ userId, endpoint, keys: KEYS });
  await notificationRepository.updatePrefs(userId, { notificationChannel: "web" });
  harness.reset();
  return { telegramId, userId };
}

const payload: NotificationPayload = {
  hour: 9,
  word: { original: "most", headword: "most", emoji: "", translations: {} },
};

describe("web push delivery (integration)", () => {
  it("delivers to every installed app and not to Telegram", async () => {
    const harness = createBotHarness();
    const endpoints = [
      `https://fcm.googleapis.com/fcm/send/a-${Date.now()}`,
      `https://web.push.apple.com/b-${Date.now()}`,
    ];
    const { telegramId, userId } = await arrangeWebUser(harness, endpoints);
    const sender = fakeSender(() => "ok");
    const { sendFn } = await buildNotificationScheduling(harness.bot.api, {
      generateObject: noLiveAi,
      webPushSender: sender,
    });

    await sendFn(userId, payload);

    expect(sender.sent.map((s) => s.endpoint).sort()).toEqual([...endpoints].sort());
    expect(sender.sent[0]?.payload).toMatchObject({ body: "Do you remember “most”?", url: "/review/" });
    expect(messagesTo(harness.sent, telegramId)).toHaveLength(0);
    const { deliveries } = await notificationDeliveryRepository.list({ page: 1, limit: 5, userId });
    expect(deliveries[0]).toMatchObject({ kind: "word_card", meta: expect.objectContaining({ channel: "web" }) });
  });

  it("drops a dead subscription and falls back to Telegram when none is left", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeWebUser(harness, [
      `https://fcm.googleapis.com/fcm/send/gone-${Date.now()}`,
    ]);
    const { sendFn } = await buildNotificationScheduling(harness.bot.api, {
      generateObject: noLiveAi,
      webPushSender: fakeSender(() => "gone"),
    });

    await sendFn(userId, payload);

    expect(await pushSubscriptionRepository.countForUser(userId)).toBe(0);
    expect((await userRepository.getSettings(userId))?.notificationChannel).toBe("bot");
    expect(messagesTo(harness.sent, telegramId)).toHaveLength(1);
  });

  it("throws on a transient push failure, keeping the subscription and the channel", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeWebUser(harness, [
      `https://fcm.googleapis.com/fcm/send/flaky-${Date.now()}`,
    ]);
    const { sendFn, deps } = await buildNotificationScheduling(harness.bot.api, {
      generateObject: noLiveAi,
      webPushSender: fakeSender(() => new Error("503 from push service")),
    });

    const failure = await sendFn(userId, payload).then(
      () => null,
      (err: unknown) => err,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(deps.isUserBlocked?.(failure)).toBe(false);
    expect(await pushSubscriptionRepository.countForUser(userId)).toBe(1);
    expect((await userRepository.getSettings(userId))?.notificationChannel).toBe("web");
    expect(messagesTo(harness.sent, telegramId)).toHaveLength(0);
  });

  it("keeps Telegram delivery for a learner on the bot channel", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeWebUser(harness, [
      `https://fcm.googleapis.com/fcm/send/bot-${Date.now()}`,
    ]);
    await notificationRepository.updatePrefs(userId, { notificationChannel: "bot" });
    const sender = fakeSender(() => "ok");
    const { sendFn } = await buildNotificationScheduling(harness.bot.api, {
      generateObject: noLiveAi,
      webPushSender: sender,
    });

    await sendFn(userId, payload);

    expect(sender.sent).toHaveLength(0);
    expect(messagesTo(harness.sent, telegramId)).toHaveLength(1);
  });
});

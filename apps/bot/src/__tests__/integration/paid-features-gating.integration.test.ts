/**
 * Paid features on a translation card — grammY e2e integration test (Task 79).
 *
 * Drives the whole conversion loop through the real dispatcher, the real DI
 * container and the real Postgres: a Free user sees ⭐ badges, tapping one opens
 * the priced plan comparison, the test payment writes a genuine `subscriptions`
 * row, and the feature the user just bought starts working on the next tap while
 * a Pro-only one still does not.
 *
 * What a mock-only test cannot pin down and this does: that the badge is purely
 * cosmetic (identical callback data before and after buying), that a denied tap
 * costs nothing downstream (no synthesis, no AI call), and that buying Pro
 * supersedes the Plus row instead of stacking a second active subscription.
 */
import {
  botSessionRepository,
  subscriptionRepository,
  translationRequestRepository,
  userRepository,
} from "@polyglot/adapter-db";
import { formatLongDate } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04]);

/** `tts_cache` is global and shared by both workers, so every harness gets its own model id. */
function arrangeHarness() {
  const modelId = `test/tts-paid-${process.pid}-${uniqueTelegramId()}`;
  const generateSpeech = vi.fn().mockResolvedValue({ bytes: AUDIO, generationId: "gen-paid-test" });
  const harness = createBotHarness({
    ai: { ...deterministicTranslateAi(), generateSpeech },
    settings: {
      getTtsConfig: vi.fn().mockResolvedValue({ enabled: true, modelId, voice: "Kore", maxChars: 200 }),
    },
  });
  return { harness, generateSpeech };
}

const messages = (harness: BotHarness): CapturedCall[] => harness.sent.filter((call) => call.method === "sendMessage");

/** Text of the last message the bot sent. */
function lastMessageText(harness: BotHarness): string {
  return String(messages(harness).at(-1)?.payload.text ?? "");
}

/** Callback data of the buttons on the last message the bot sent. */
function lastMessageButtons(harness: BotHarness): string[] {
  const markup = messages(harness).at(-1)?.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

/** Labels of the last rendered card's buttons, keyed by callback data. */
function cardLabels(harness: BotHarness): Record<string, string> {
  const edit = harness.sent.filter((call) => call.method === "editMessageReplyMarkup").at(-1);
  const markup = edit?.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string; text?: string }>> }
    | undefined;
  const labels: Record<string, string> = {};
  for (const button of (markup?.inline_keyboard ?? []).flat()) {
    if (button.callback_data && button.text) labels[button.callback_data] = button.text;
  }
  return labels;
}

/** Send a word and return the rendered card. */
async function renderCard(harness: BotHarness, chatId: number, word: string) {
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text: word }));
  return lastRenderedCard(harness.sent);
}

const tap = (harness: BotHarness, chatId: number, messageId: number, data: string) =>
  harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId, data }));

/** Walk the fake checkout: upsell → plan → confirm. */
async function buyPlan(harness: BotHarness, chatId: number, messageId: number, plan: string) {
  await tap(harness, chatId, messageId, `plan:buy:${plan}`);
  await tap(harness, chatId, messageId, `plan:confirm:${plan}`);
}

describe("paid features on a translation card (integration)", () => {
  it("badges the paid buttons for a Free user and turns a tap into the priced plan comparison", async () => {
    // Arrange
    const { harness, generateSpeech } = arrangeHarness();
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id); // native en, learning cs → free plan

    // Act
    const { messageId: cardMsgId, buttons } = await renderCard(harness, id, "hello");

    // Assert — the badge is on the paid buttons only, and Save stays plain.
    const labels = cardLabels(harness);
    expect(labels[`tr:clarifypost:${cardMsgId}`]).toContain("⭐");
    expect(labels[`tr:altmeaning:${cardMsgId}`]).toContain("⭐");
    expect(labels[`tr:say:cs:${cardMsgId}`]).toContain("⭐");
    expect(labels[`tr:save:${cardMsgId}`]).not.toContain("⭐");
    // Locked or not, the card carries the same buttons — nothing is hidden.
    expect(buttons).toContain(`tr:say:cs:${cardMsgId}`);

    // Act — tap the badged speaker.
    harness.reset();
    await tap(harness, id, cardMsgId, `tr:say:cs:${cardMsgId}`);

    // Assert — no synthesis, no voice, and the plan comparison with real prices.
    expect(generateSpeech).not.toHaveBeenCalled();
    expect(harness.sent.filter((call) => call.method === "sendVoice")).toHaveLength(0);
    const upsell = lastMessageText(harness);
    // The headline names the tapped feature and the cheapest plan that carries it —
    // Pro — even though the cheaper Plus rung is still on offer below it.
    expect(upsell).toContain("Word audio is a <b>Pro</b> feature");
    expect(upsell).toContain("$5");
    expect(upsell).toContain("$10");
    expect(lastMessageButtons(harness)).toEqual(["plan:buy:plus", "plan:buy:pro"]);

    // The offer reads as a ladder: Plus lists what it includes, Pro only what it
    // adds on top. Nothing a Plus subscriber already has is restated under Pro.
    expect(upsell).toContain("Unlimited translations");
    expect(upsell).toContain("Everything in Plus");
    expect(upsell).toContain("Word audio");
    expect(upsell.match(/Grammar and etymology/g)).toHaveLength(1);
    // Video is sold by what it produces, and no paid tier advertises a quota.
    expect(upsell).toContain("Vocabulary from YouTube videos");
    expect(upsell).not.toMatch(/\d+ videos/);

    // Assert — nothing was bought by merely looking at the offer.
    expect(await subscriptionRepository.findActiveByUser(userId)).toBeNull();
  });

  it("buys Plus through the test-payment confirmation and unlocks clarify — but not Pro-only audio", async () => {
    // Arrange
    const { harness, generateSpeech } = arrangeHarness();
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    const { messageId: cardMsgId } = await renderCard(harness, id, "hello");

    // Act — pick Plus. Confirmation first: nothing is written yet.
    harness.reset();
    await tap(harness, id, cardMsgId, "plan:buy:plus");

    // Assert — a test payment is announced and offers a way out.
    expect(lastMessageButtons(harness)).toEqual(["plan:confirm:plus", "plan:cancel"]);
    expect(await subscriptionRepository.findActiveByUser(userId)).toBeNull();

    // Act — confirm.
    harness.reset();
    await tap(harness, id, cardMsgId, "plan:confirm:plus");

    // Assert — a real subscription and a real plan pointer, not a UI flag.
    const subscription = await subscriptionRepository.findActiveByUser(userId);
    expect(subscription).toMatchObject({ plan: "plus", status: "active", provider: "mock" });
    expect(subscription!.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    expect((await userRepository.findById(userId))?.subscriptionPlan).toBe("plus");

    // The confirmation reads as a sentence, not as a serial number: the date is
    // spelled in the language the message is written in, never as `2026-09-22`.
    const confirmation = lastMessageText(harness);
    expect(confirmation).toContain(formatLongDate(subscription!.currentPeriodEnd, "en", "UTC"));
    expect(confirmation).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    // Act — the clarify button the user could not use a moment ago.
    harness.reset();
    await tap(harness, id, cardMsgId, `tr:clarifypost:${cardMsgId}`);

    // Assert — the clarify flow ran instead of the upsell: a prompt with no buy
    // buttons, and the session now waiting for the context the user will type.
    expect(lastMessageButtons(harness)).toEqual([]);
    expect(lastMessageText(harness).length).toBeGreaterThan(0);
    const session = await botSessionRepository.get(String(id));
    expect(session?.data).toMatchObject({ awaitingTranslationClarificationContext: true });

    // Act — audio is the Pro differentiator; Plus must still be refused.
    harness.reset();
    await tap(harness, id, cardMsgId, `tr:say:cs:${cardMsgId}`);

    // Assert — the offer answers the tap by name and sells only the rung above:
    // Plus is what the user already pays for, and its button could only be refused.
    expect(generateSpeech).not.toHaveBeenCalled();
    const upsell = lastMessageText(harness);
    expect(upsell).toContain("Word audio is a <b>Pro</b> feature");
    expect(upsell).toContain("Everything in Plus");
    expect(upsell).not.toContain("$5");
    expect(lastMessageButtons(harness)).toEqual(["plan:buy:pro"]);

    // Assert — a card rendered after the upgrade drops the badge it no longer needs.
    harness.reset();
    const { messageId: freshCardId } = await renderCard(harness, id, "bridge");
    const labels = cardLabels(harness);
    expect(labels[`tr:clarifypost:${freshCardId}`]).not.toContain("⭐");
    expect(labels[`tr:say:cs:${freshCardId}`]).toContain("⭐");
  });

  it("upgrading Plus → Pro supersedes the old subscription and unlocks audio", async () => {
    // Arrange
    const { harness, generateSpeech } = arrangeHarness();
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    const { messageId: cardMsgId } = await renderCard(harness, id, "hello");
    await buyPlan(harness, id, cardMsgId, "plus");
    const plusSubscription = (await subscriptionRepository.findActiveByUser(userId))!;

    // Act
    harness.reset();
    await buyPlan(harness, id, cardMsgId, "pro");

    // Assert — exactly one active subscription, and it is the new one.
    const active = await subscriptionRepository.findActiveByUser(userId);
    expect(active).toMatchObject({ plan: "pro", status: "active" });
    expect(active!.id).not.toBe(plusSubscription.id);
    expect((await userRepository.findById(userId))?.subscriptionPlan).toBe("pro");

    // Act — the Pro-only feature.
    harness.reset();
    await tap(harness, id, cardMsgId, `tr:say:cs:${cardMsgId}`);

    // Assert — the word is actually spoken now.
    expect(generateSpeech).toHaveBeenCalledTimes(1);
    expect(harness.sent.filter((call) => call.method === "sendVoice")).toHaveLength(1);
    expect(lastMessageButtons(harness)).toEqual([]);
  });

  it("tells a Pro subscriber there is nothing left to buy instead of an empty menu", async () => {
    // Arrange — Pro is the top of the priced ladder.
    const { harness } = arrangeHarness();
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);
    const { messageId: cardMsgId } = await renderCard(harness, id, "hello");
    await buyPlan(harness, id, cardMsgId, "pro");

    // Act — the upgrade CTA a limit gate would show.
    harness.reset();
    await tap(harness, id, cardMsgId, "plan:upgrade");

    // Assert — a plain statement of fact, not a warning about broken pricing.
    expect(lastMessageText(harness)).toContain("already on the top plan");
    expect(lastMessageText(harness)).not.toContain("⚠️");
    expect(lastMessageButtons(harness)).toEqual([]);
  });

  it("backing out of the test payment leaves the user on Free", async () => {
    // Arrange
    const { harness } = arrangeHarness();
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    const { messageId: cardMsgId } = await renderCard(harness, id, "hello");

    // Act
    harness.reset();
    await tap(harness, id, cardMsgId, "plan:buy:pro");
    await tap(harness, id, cardMsgId, "plan:cancel");

    // Assert
    expect(await subscriptionRepository.findActiveByUser(userId)).toBeNull();
    expect((await userRepository.findById(userId))?.subscriptionPlan).toBe("free");
    expect(lastMessageButtons(harness)).toEqual([]);
  });

  it("stops the 11th translation of the month on Free and offers the upgrade", async () => {
    // Arrange — the free plan allows 10 translations/month; spend them through the
    // real ledger rather than by dispatching ten pipeline runs.
    const { harness } = arrangeHarness();
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    for (let spent = 0; spent < 10; spent += 1) {
      await translationRequestRepository.logTranslationRequest(userId, `spent-${spent}`, "en", ["cs"], 1);
    }

    // Act
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));

    // Assert — refused with a way out, and no card was rendered.
    expect(lastMessageButtons(harness)).toEqual(["plan:upgrade"]);
    expect(harness.sent.some((call) => call.method === "editMessageReplyMarkup")).toBe(false);
  });

  it("refuses a hand-crafted purchase of a plan that is not for sale", async () => {
    // Arrange — `unlimited` is an internal plan: active, but priced null.
    const { harness } = arrangeHarness();
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    const { messageId: cardMsgId } = await renderCard(harness, id, "hello");

    // Act — the callback data a forwarded/edited button could carry.
    harness.reset();
    await tap(harness, id, cardMsgId, "plan:confirm:unlimited");

    // Assert — refused, and nothing granted.
    expect(await subscriptionRepository.findActiveByUser(userId)).toBeNull();
    expect((await userRepository.findById(userId))?.subscriptionPlan).toBe("free");
  });
});

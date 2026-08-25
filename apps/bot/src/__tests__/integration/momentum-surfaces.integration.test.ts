/**
 * Recovery line and praise line — grammY e2e integration test (Task 81, Slices 3–4,
 * §8.2.3/§8.2.4).
 *
 * Both surfaces are one line glued to a message the bot was going to send anyway, so
 * every assertion here is on the text that actually left the harness, on the journal
 * row that claimed it, and on the Prometheus counters behind the §7.2 safeties.
 *
 * `recoveryEnabled` / `praiseEnabled` are set by swapping `services.momentumService`
 * for one built on the same real repository with the flags this test needs — the
 * route `momentum-recording.integration.test.ts` already takes. Neither a
 * `system_settings` row (global, and this lane runs two workers against one database)
 * nor the harness's `settings` override reaches it: the container closes over the
 * SettingsService instance it was built with, so replacing `services.settings`
 * afterwards leaves the momentum service reading the real switches.
 *
 * Time is driven with `vi.setSystemTime` over a Date-only fake, as in
 * `momentum-recording.integration.test.ts`: every momentum instant comes from the
 * app's injected clock (§4.4), while full fake timers would freeze the `setTimeout`
 * the Postgres driver and the long-op guard depend on.
 */
import { getLang, momentumRepository, vocabularyRepository } from "@polyglot/adapter-db";
import { createMomentumService, DEFAULT_MOTIVATION_CONFIG, type MotivationConfig, t } from "@polyglot/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { motivationPraiseCounter, motivationPraiseSuppressedCounter } from "../../metrics.js";
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

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-08T09:00:00.000Z");
const YESTERDAY = new Date(NOW.getTime() - DAY_MS);
/** Comfortably past the seven-day gap, and a number no card text may print (§2.2, rule 3). */
const NINE_DAYS_AGO = new Date(NOW.getTime() - 9 * DAY_MS);
const FAR_FUTURE = new Date("2027-01-01T00:00:00.000Z");

const RECOVERY_LINE = t("recoveryLine", "en");

/** A momentum service on the real journal, with the kill switches under the test's control. */
function momentumServiceWith(flags: Partial<MotivationConfig>) {
  return createMomentumService({
    momentumRepository,
    getMotivationConfig: async () => ({ ...DEFAULT_MOTIVATION_CONFIG, ...flags }),
    getTimezone: async () => "UTC",
  });
}

function sentTexts(sent: CapturedCall[]): string[] {
  return sent
    .filter((call) => call.method === "sendMessage")
    .map((call) => String((call.payload as { text?: string }).text ?? ""));
}

/**
 * Text of the most recently rendered translation card.
 *
 * Resolved through the card's own message id (the `editMessageReplyMarkup` that
 * attaches its keyboard) rather than "the last sendMessage", so the loading
 * placeholder and any trailing notice can never be mistaken for the card.
 */
function lastCardText(sent: CapturedCall[]): string {
  const { messageId } = lastRenderedCard(sent);
  const call = sent.find((entry) => entry.method === "sendMessage" && entry.messageId === messageId);
  if (!call) throw new Error("the rendered card's sendMessage was not captured");
  return String((call.payload as { text?: string }).text ?? "");
}

function lastEditedText(sent: CapturedCall[]): string {
  const call = sent.filter((entry) => entry.method === "editMessageText").at(-1);
  if (!call) throw new Error("the bot edited no message");
  return String((call.payload as { text?: string }).text ?? "");
}

async function praiseShownCount(kind: string, surface: string): Promise<number> {
  const metric = await motivationPraiseCounter.get();
  return metric.values.find((value) => value.labels.kind === kind && value.labels.surface === surface)?.value ?? 0;
}

async function praiseSuppressedCount(reason: string): Promise<number> {
  const metric = await motivationPraiseSuppressedCounter.get();
  return metric.values.find((value) => value.labels.reason === reason)?.value ?? 0;
}

/** Every `praise` token this user ever earned — the journal is what makes "once" true. */
function praiseRowCount(userId: number): Promise<number> {
  return momentumRepository.countEventsSince(userId, "praise", new Date(0));
}

/** Seed saved words; the first `due` of them are due for review now, the rest are not. */
async function seedWords(userId: number, options: { count: number; due?: number }): Promise<void> {
  const source = getLang("en");
  const target = getLang("cs");
  if (!source || !target) throw new Error("language cache is not loaded (en/cs missing)");

  for (let index = 0; index < options.count; index += 1) {
    const entry = await vocabularyRepository.create(userId, {
      original: `seed-${userId}-${index}`,
      sourceLangId: source.id,
      inputType: "word",
      unverified: false,
      translations: [{ targetLangId: target.id, text: `slovo-${index}`, details: { synonyms: [], examples: [] } }],
    });
    const translationId = entry.translations[0]?.id;
    if (translationId === undefined) throw new Error(`seeded entry ${index} has no translation`);
    await vocabularyRepository.updateSrsState(translationId, {
      easeFactor: 2.5,
      interval: 6,
      dueDate: index < (options.due ?? 0) ? YESTERDAY : FAR_FUTURE,
      reviewCount: 2,
    });
  }
}

/**
 * One due card standing one review short of long-term memory: SM-2 turns interval 15
 * on the fourth "good" into 38, which is past the stuck threshold of 21 (§3.10).
 */
async function seedAlmostMatureCard(userId: number): Promise<void> {
  const source = getLang("en");
  const target = getLang("cs");
  if (!source || !target) throw new Error("language cache is not loaded (en/cs missing)");

  const entry = await vocabularyRepository.create(userId, {
    original: `almost-mature-${userId}`,
    sourceLangId: source.id,
    inputType: "word",
    unverified: false,
    translations: [{ targetLangId: target.id, text: "skoro", details: { synonyms: [], examples: [] } }],
  });
  const translationId = entry.translations[0]?.id;
  if (translationId === undefined) throw new Error("seeded entry has no translation");
  await vocabularyRepository.updateSrsState(translationId, {
    easeFactor: 2.5,
    interval: 15,
    dueDate: YESTERDAY,
    reviewCount: 3,
  });
}

/** Translate one word and return the id of the card the bot rendered. */
async function translateWord(harness: BotHarness, chatId: number, word: string): Promise<number> {
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text: word }));
  return lastRenderedCard(harness.sent).messageId;
}

/** Finish a one-card SRS session: `/review` → reveal → rate "good". */
async function reviewOneCard(harness: BotHarness, chatId: number): Promise<void> {
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text: "/review" }));
  const cardMsgId = harness.sent.filter((call) => call.method === "sendMessage").at(-1)?.messageId;
  if (cardMsgId === undefined) throw new Error("no SRS card was sent — the seeded word was not due");
  await harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId: cardMsgId, data: "srs:reveal" }));
  await harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId: cardMsgId, data: "srs:rate:good" }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("recovery line (integration)", () => {
  it("prefixes one card with the welcome and the real due count, and never names the pause", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    harness.services.momentumService = momentumServiceWith({ recoveryEnabled: true });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await seedWords(userId, { count: 3, due: 2 });
    await momentumRepository.applySnapshot(userId, { lastSeenAt: NINE_DAYS_AGO, updatedAt: NINE_DAYS_AGO });

    await translateWord(harness, id, "hello");

    const text = lastCardText(harness.sent);
    expect(text.startsWith(RECOVERY_LINE)).toBe(true);
    expect(text).toContain(t("recoveryDue", "en", { count: 2 }));
    // The anti-pattern this slice exists to avoid: "we haven't seen you in 9 days".
    expect(text).not.toMatch(/\b9\b/);
    expect(text.toLowerCase()).not.toMatch(/day|week|pause|miss/);
    expect(sentTexts(harness.sent).filter((sent) => sent.includes(RECOVERY_LINE))).toHaveLength(1);

    const snapshot = await momentumRepository.getSnapshot(userId);
    expect(snapshot?.lastSeenAt?.toISOString()).toBe(NOW.toISOString());
    expect(snapshot?.lastRecoveryAt?.toISOString()).toBe(NOW.toISOString());

    // The line is a one-shot: the same user's next word the same day is an ordinary card.
    harness.reset();
    await translateWord(harness, id, "bridge");
    expect(lastCardText(harness.sent)).not.toContain(RECOVERY_LINE);
  });

  it("stays silent for a user who was here yesterday, and advances lastSeenAt anyway", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    harness.services.momentumService = momentumServiceWith({ recoveryEnabled: true });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await momentumRepository.applySnapshot(userId, { lastSeenAt: YESTERDAY, updatedAt: YESTERDAY });

    await translateWord(harness, id, "hello");

    expect(lastCardText(harness.sent)).not.toContain(RECOVERY_LINE);
    const snapshot = await momentumRepository.getSnapshot(userId);
    expect(snapshot?.lastSeenAt?.toISOString()).toBe(NOW.toISOString());
    expect(snapshot?.lastRecoveryAt).toBeNull();
  });

  it("does not spend the returning user's one shot on a callback tap", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    harness.services.momentumService = momentumServiceWith({ recoveryEnabled: true });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);

    // A card to tap, rendered while the user is not yet "away".
    const cardMsgId = await translateWord(harness, id, "hello");
    await momentumRepository.applySnapshot(userId, { lastSeenAt: NINE_DAYS_AGO, updatedAt: NOW });

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );

    // Deferred delivery (§2.2 S3): a callback has no text carrier of its own, so it
    // neither shows the line nor invents a message to carry it — and crucially it does
    // not mark the user as seen, or the line would be lost for good.
    expect(harness.sent.filter((call) => call.method === "sendMessage")).toHaveLength(0);
    const snapshot = await momentumRepository.getSnapshot(userId);
    expect(snapshot?.lastSeenAt?.toISOString()).toBe(NINE_DAYS_AGO.toISOString());
  });

  it("delivers the line on the clarification card when the first word after the pause is ambiguous", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const harness = createBotHarness({ ai: deterministicTranslateAi({ unrecognizedWord: "hello" }) });
    harness.services.momentumService = momentumServiceWith({ recoveryEnabled: true });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await momentumRepository.applySnapshot(userId, { lastSeenAt: NINE_DAYS_AGO, updatedAt: NINE_DAYS_AGO });

    // The clarification prompt is not a card and carries nothing — and must not burn the shot.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "hello" }));
    const promptCall = harness.sent.filter((call) => call.method === "sendMessage").at(-1);
    if (promptCall === undefined) throw new Error("no clarification prompt was sent");
    expect(String((promptCall.payload as { text?: string }).text ?? "")).not.toContain(RECOVERY_LINE);
    expect((await momentumRepository.getSnapshot(userId))?.lastSeenAt?.toISOString()).toBe(NINE_DAYS_AGO.toISOString());

    await harness.dispatch(
      callbackQueryUpdate({
        chatId: id,
        fromId: id,
        messageId: promptCall.messageId ?? 0,
        data: "tr:clarify:context",
      }),
    );
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "a spoken greeting" }));

    expect(lastCardText(harness.sent).startsWith(RECOVERY_LINE)).toBe(true);

    // And it is not repeated on the next ordinary card.
    harness.reset();
    await translateWord(harness, id, "bridge");
    expect(lastCardText(harness.sent)).not.toContain(RECOVERY_LINE);
  });
});

describe("praise line (integration)", () => {
  it("carries the tenth-word milestone on the next card only, and counts the cooldown suppression", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    harness.services.momentumService = momentumServiceWith({ praiseEnabled: true });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await seedWords(userId, { count: 9 });

    // The tenth save. Its own card was rendered before the save, so it cannot carry
    // the milestone — the praise waits for the next card the user asks for.
    const cardMsgId = await translateWord(harness, id, "hello");
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );
    expect(await vocabularyRepository.countByUser(userId)).toBe(10);
    expect(lastCardText(harness.sent)).not.toContain(t("praiseDictionary10", "en", { count: 10 }));

    const shownBefore = await praiseShownCount("dictionary_10", "translation_card");
    harness.reset();
    await translateWord(harness, id, "bridge");
    expect(lastCardText(harness.sent)).toContain(t("praiseDictionary10", "en", { count: 10 }));
    expect(await praiseShownCount("dictionary_10", "translation_card")).toBe(shownBefore + 1);
    expect(await praiseRowCount(userId)).toBe(1);

    const cooldownBefore = await praiseSuppressedCount("cooldown");
    harness.reset();
    await translateWord(harness, id, "river");
    expect(lastCardText(harness.sent)).not.toContain(t("praiseDictionary10", "en", { count: 10 }));
    expect(await praiseSuppressedCount("cooldown")).toBe(cooldownBefore + 1);
    expect(await praiseRowCount(userId)).toBe(1);
  });

  it("says nothing anywhere while the praise kill switch is off", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    harness.services.momentumService = momentumServiceWith({ praiseEnabled: false });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    // Exactly the evidence that would otherwise be praised on the very next card.
    await seedWords(userId, { count: 10, due: 1 });

    const killswitchBefore = await praiseSuppressedCount("killswitch");
    await translateWord(harness, id, "hello");
    expect(lastCardText(harness.sent)).not.toContain(t("praiseDictionary10", "en", { count: 10 }));

    harness.reset();
    await reviewOneCard(harness, id);
    expect(lastEditedText(harness.sent)).not.toContain(t("praiseDictionary10", "en", { count: 10 }));

    expect(await praiseSuppressedCount("killswitch")).toBe(killswitchBefore + 2);
    expect(await praiseRowCount(userId)).toBe(0);
  });

  it("puts one praise line in the srsDone text when a word reaches long-term memory", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    harness.services.momentumService = momentumServiceWith({ praiseEnabled: true });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await seedAlmostMatureCard(userId);

    const shownBefore = await praiseShownCount("first_mature", "srs_done");
    await reviewOneCard(harness, id);

    const done = lastEditedText(harness.sent);
    expect(done).toContain(t("srsDone", "en", { count: "1" }));
    expect(done).toContain(t("praiseFirstMature", "en"));
    expect(await praiseShownCount("first_mature", "srs_done")).toBe(shownBefore + 1);
    expect(await praiseRowCount(userId)).toBe(1);
  });

  it("yields to the recovery line when both are earned by the same update", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    harness.services.momentumService = momentumServiceWith({ recoveryEnabled: true, praiseEnabled: true });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await seedWords(userId, { count: 10, due: 3 });
    await momentumRepository.applySnapshot(userId, { lastSeenAt: NINE_DAYS_AGO, updatedAt: NINE_DAYS_AGO });

    await translateWord(harness, id, "hello");

    const text = lastCardText(harness.sent);
    expect(text.startsWith(RECOVERY_LINE)).toBe(true);
    expect(text).not.toContain(t("praiseDictionary10", "en", { count: 10 }));
    // The praise cooldown is not spent on the loss: nothing was claimed for it.
    expect(await praiseRowCount(userId)).toBe(0);
    expect((await momentumRepository.getSnapshot(userId))?.lastPraiseAt).toBeNull();
  });
});

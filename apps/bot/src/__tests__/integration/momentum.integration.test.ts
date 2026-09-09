/**
 * `/progress` — grammY e2e integration test (Task 81, Slice 2, §8.2.3).
 *
 * Drives the screen through the REAL dispatcher and a real Postgres from both of
 * its entry points: the typed command and the 📈 button on the SRS done-keyboard,
 * the latter reached by actually finishing a review session rather than by
 * synthesising the tap.
 *
 * `enabled` is flipped through the harness's settings override rather than a
 * `system_settings` row: that table is global and this lane runs two workers
 * against one database (see `bot-harness.ts`).
 *
 * Time is driven with `vi.setSystemTime` over a Date-only fake, as in
 * `momentum-recording.integration.test.ts`: full fake timers would freeze the
 * Postgres driver's own `setTimeout`.
 */
import { getLang, momentumRepository, vocabularyRepository } from "@polyglot/adapter-db";
import { DEFAULT_MOTIVATION_CONFIG, MATURE_INTERVAL_DAYS, t } from "@polyglot/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { motivationProgressOpenedCounter } from "../../metrics.js";
import { collectEvents, stopCollecting } from "../../observability/__tests__/event-collector.js";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

const NOW = new Date("2026-06-10T09:00:00.000Z");
const FAR_FUTURE = new Date("2027-01-01T00:00:00.000Z");
const YESTERDAY = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

/**
 * A discounted score inside the `steady` band (33–65, §3.6) whose digits appear in
 * none of the counters — so "the raw score is never rendered" is assertable.
 */
const STEADY_SCORE = 44.5;

/** Motivation config with only the surface switch this slice owns turned on. */
function motivationSettings(enabled: boolean) {
  return { getMotivationConfig: async () => ({ ...DEFAULT_MOTIVATION_CONFIG, enabled }) };
}

function lastSentMessage(sent: CapturedCall[]): { text: string; buttons: string[][] } {
  const call = sent.filter((entry) => entry.method === "sendMessage").at(-1);
  if (!call) throw new Error("the bot sent no message");
  const markup = call.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return {
    text: String((call.payload as { text?: string }).text ?? ""),
    buttons: (markup?.inline_keyboard ?? []).map((row) =>
      row.map((button) => button.callback_data).filter((data): data is string => typeof data === "string"),
    ),
  };
}

/** The inline keyboard of the most recent `editMessageText` — how a done screen is delivered. */
function lastEditedKeyboard(sent: CapturedCall[]): string[][] {
  const call = sent.filter((entry) => entry.method === "editMessageText").at(-1);
  if (!call) throw new Error("the bot edited no message");
  const markup = call.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? []).map((row) =>
    row.map((button) => button.callback_data).filter((data): data is string => typeof data === "string"),
  );
}

async function readProgressOpened(band: string): Promise<number> {
  const metric = await motivationProgressOpenedCounter.get();
  return metric.values.find((value) => value.labels.band === band)?.value ?? 0;
}

/** Seed `count` saved words; the first `mature` of them sit past the stuck threshold, the next `due` are due now. */
async function seedVocabulary(userId: number, options: { count: number; mature: number; due: number }): Promise<void> {
  const source = getLang("en");
  const target = getLang("cs");
  if (!source || !target) throw new Error("language cache is not loaded (en/cs missing)");

  for (let index = 0; index < options.count; index += 1) {
    const entry = await vocabularyRepository.create(userId, {
      original: `word-${index}`,
      sourceLangId: source.id,
      inputType: "word",
      unverified: false,
      translations: [{ targetLangId: target.id, text: `slovo-${index}`, details: { synonyms: [], examples: [] } }],
    });
    const translationId = entry.translations[0]?.id;
    if (translationId === undefined) throw new Error(`seeded entry ${index} has no translation`);

    if (index < options.mature) {
      await vocabularyRepository.updateSrsState(translationId, {
        easeFactor: 2.5,
        interval: MATURE_INTERVAL_DAYS,
        dueDate: FAR_FUTURE,
        reviewCount: 4,
      });
    } else if (index < options.mature + options.due) {
      await vocabularyRepository.updateSrsState(translationId, {
        easeFactor: 2.5,
        interval: 6,
        dueDate: YESTERDAY,
        reviewCount: 2,
      });
    } else {
      // `create` leaves a brand-new card due tomorrow, which the remaining words keep.
      await vocabularyRepository.updateSrsState(translationId, {
        easeFactor: 2.5,
        interval: 1,
        dueDate: FAR_FUTURE,
        reviewCount: 1,
      });
    }
  }
}

/** Journal rows on `days` distinct local days, so `countActiveDays` has something to count. */
async function seedActiveDays(userId: number, days: number): Promise<void> {
  for (let day = 1; day <= days; day += 1) {
    await momentumRepository.recordEvent({
      userId,
      kind: "review",
      weight: 3,
      occurredAt: new Date(NOW.getTime() - day * 24 * 60 * 60 * 1000),
      dedupeKey: `seed:review:${userId}:${day}`,
    });
  }
}

/** Finish a one-card SRS session and return the keyboard of the done screen. */
async function finishSrsSession(harness: BotHarness, chatId: number): Promise<string[][]> {
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text: "/review" }));
  const cardMsgId = harness.sent.filter((call) => call.method === "sendMessage").at(-1)?.messageId;
  if (cardMsgId === undefined) throw new Error("no SRS card was sent — the seeded word was not due");
  await harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId: cardMsgId, data: "srs:reveal" }));
  await harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId: cardMsgId, data: "srs:rate:good" }));
  return lastEditedKeyboard(harness.sent);
}

afterEach(() => {
  stopCollecting();
  vi.useRealTimers();
});

describe("/progress (integration)", () => {
  it("shows the band, the four counters and one review button — and never the raw score", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const harness = createBotHarness({ settings: motivationSettings(true) });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await seedVocabulary(userId, { count: 12, mature: 3, due: 4 });
    await seedActiveDays(userId, 3);
    await momentumRepository.applySnapshot(userId, { score: STEADY_SCORE, scoredAt: NOW, updatedAt: NOW });

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/progress" }));

    const screen = lastSentMessage(harness.sent);
    expect(screen.text).toContain(t("progressTitle", "en"));
    expect(screen.text).toContain(t("progressBandSteady", "en"));
    expect(screen.text).toContain(t("progressWords", "en", { count: 12 }));
    expect(screen.text).toContain(t("progressMature", "en", { count: 3 }));
    expect(screen.text).toContain(t("progressDue", "en", { count: 4 }));
    expect(screen.text).toContain(t("progressActiveDays", "en", { count: 3 }));

    // §3.6: the number behind the band is never shown, in any rounding.
    expect(screen.text).not.toContain("44.5");
    expect(screen.text).not.toContain("44");
    expect(screen.text).not.toContain("45");

    // One next step, and it is the existing SRS entry — not a new route.
    expect(screen.buttons).toEqual([["srs:restart"]]);
    expect(screen.text).not.toContain(t("progressEmpty", "en"));
  });

  it("is reachable from the SRS done screen and reports that entry point", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const harness = createBotHarness({ settings: motivationSettings(true) });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await seedVocabulary(userId, { count: 1, mature: 0, due: 1 });

    const doneKeyboard = await finishSrsSession(harness, id);
    // Its own row (§6): a third button beside restart/close would be squeezed unreadable.
    expect(doneKeyboard).toEqual([["srs:restart", "srs:close"], ["progress:open:srs_done"]]);

    const events = collectEvents();
    const before = await readProgressOpened("resting");
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: 1, data: "progress:open:srs_done" }),
    );

    // A NEW message, not an edit of the session's receipt.
    expect(harness.sent.filter((call) => call.method === "editMessageText")).toHaveLength(0);
    expect(harness.sent.some((call) => call.method === "answerCallbackQuery")).toBe(true);
    expect(lastSentMessage(harness.sent).text).toContain(t("progressTitle", "en"));

    const opened = events.named("momentum.progress_opened");
    expect(opened).toHaveLength(1);
    expect(opened[0]?.fields.entry).toBe("srs_done");
    // A single review is worth 3 points, so this user is squarely in the bottom band.
    expect(opened[0]?.fields.band).toBe("resting");
    expect(await readProgressOpened("resting")).toBe(before + 1);
  });

  it("shows the empty state — no counters and no band — to a user with no words", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const harness = createBotHarness({ settings: motivationSettings(true) });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/progress" }));

    const screen = lastSentMessage(harness.sent);
    expect(screen.text).toContain(t("progressEmpty", "en"));
    expect(screen.text).toContain(t("progressEmptyHint", "en"));
    expect(screen.text).not.toMatch(/\d/);
    for (const band of [
      "progressBandResting",
      "progressBandWarming",
      "progressBandSteady",
      "progressBandStrong",
    ] as const) {
      expect(screen.text).not.toContain(t(band, "en"));
    }
    expect(screen.buttons).toEqual([]);
  });

  it("makes no outgoing Telegram call at all when the command is typed while the surface is off", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const harness = createBotHarness({ settings: motivationSettings(false) });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await seedVocabulary(userId, { count: 2, mature: 0, due: 1 });

    // The first message installs the main-menu keyboard, which is not this feature's
    // doing; the silence under test is everything after it.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/progress" }));
    harness.reset();

    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/progress", messageId: 2 }));

    expect(harness.sent).toEqual([]);
  });

  it("keeps the button off the done screen while the surface is off, and still answers a stale tap", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const harness = createBotHarness({ settings: motivationSettings(false) });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    await seedVocabulary(userId, { count: 1, mature: 0, due: 1 });

    // The switch has to gate the button, not just the handler: a 📈 that opens
    // nothing is the dead-button failure this project has already shipped once.
    expect(await finishSrsSession(harness, id)).toEqual([["srs:restart", "srs:close"]]);

    // A tap can still arrive — from a keyboard printed before the switch went off.
    // It gets no screen, but it must be answered, or the client spins on it forever.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: 1, data: "progress:open:srs_done" }),
    );

    expect(harness.sent.map((call) => call.method)).toEqual(["answerCallbackQuery"]);
  });
});

/**
 * Cards on spaced repetition — e2e (real dispatcher, real Postgres, fake `fetch`), Task 85.
 *
 * @business Cards is the only review surface, so every rating has to leave the same
 * evidence `/review` left: the SM-2 schedule for a due card, the notification grade, a
 * review log row. Practice ahead keeps the deck from being a dead end, but must never
 * lengthen a schedule the learner has not actually survived.
 *
 * Assertion triad: the wire (fronts, keyboards, toasts off the fake Telegram API), the
 * persisted rows (translation SRS columns, entry difficulty, `word_review_log`), and the
 * session moving on.
 */
import { getDb, getLang, vocabularyRepository } from "@polyglot/adapter-db";
import { type CreateVocabularyInput, t } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

const CARD_MESSAGE_ID = 900;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAST = new Date("2020-01-01T00:00:00.000Z");

function langId(code: string): number {
  const lang = getLang(code);
  if (!lang) throw new Error(`language cache is not loaded (${code} missing)`);
  return lang.id;
}

function word(original: string, targets: string[] = ["en"]): CreateVocabularyInput {
  return {
    original,
    sourceLangId: langId("de"),
    inputType: "word",
    unverified: false,
    translations: targets.map((code) => ({
      targetLangId: langId(code),
      text: `${original}-${code}`,
      details: { synonyms: [], examples: [] },
    })),
  };
}

/** Saves a word and sets its only translation's schedule; returns both ids. */
async function seed(
  userId: number,
  original: string,
  schedule: { easeFactor: number; interval: number; dueDate: Date; reviewCount: number },
): Promise<{ entryId: number; translationId: number }> {
  const entry = await vocabularyRepository.create(userId, word(original));
  const translationId = entry.translations[0]!.id;
  await vocabularyRepository.updateSrsState(translationId, schedule);
  return { entryId: entry.id, translationId };
}

async function srsOf(entryId: number) {
  const entry = await vocabularyRepository.findById(entryId);
  const translation = entry?.translations[0];
  if (!entry || !translation) throw new Error(`entry ${entryId} is gone`);
  return {
    difficulty: entry.difficulty,
    easeFactor: translation.srsEaseFactor,
    interval: translation.srsInterval,
    reviewCount: translation.srsReviewCount,
    dueDate: translation.srsDueDate,
  };
}

/** `drizzle-orm` is not a dependency of `apps/bot`; the log is read through the adapter's driver. */
async function reviewLog(entryId: number): Promise<string[]> {
  const rows = await getDb().$client<Array<{ session_type: string }>>`
    select session_type from word_review_log where entry_id = ${entryId}
  `;
  return rows.map((row) => row.session_type);
}

function lastScreen(sent: CapturedCall[]): { text: string; buttons: string[] } {
  const call = sent.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").at(-1);
  if (!call) throw new Error("nothing was rendered");
  const markup = call.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  const buttons = (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
  return { text: String(call.payload.text ?? ""), buttons };
}

function toasts(sent: CapturedCall[]): string[] {
  return sent
    .filter((call) => call.method === "answerCallbackQuery")
    .map((call) => String((call.payload as { text?: string }).text ?? ""));
}

function shownEntryId(buttons: string[]): number {
  const data = buttons.find((button) => button.startsWith("fc:del:"));
  if (!data) throw new Error(`no fc:del button on screen: ${buttons.join(", ")}`);
  return Number(data.split(":")[2]);
}

async function tap(harness: BotHarness, chatId: number, data: string): Promise<void> {
  harness.reset();
  await harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId: CARD_MESSAGE_ID, data }));
}

async function send(harness: BotHarness, chatId: number, text: string): Promise<void> {
  harness.reset();
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text }));
}

/** Reveal the card on screen and rate it; returns the entry it belonged to. */
async function rate(
  harness: BotHarness,
  chatId: number,
  rating: "again" | "hard" | "good" | "easy",
  translationIdOf: (entryId: number) => number,
): Promise<number> {
  await tap(harness, chatId, "fc:reveal");
  const entryId = shownEntryId(lastScreen(harness.sent).buttons);
  await tap(harness, chatId, `fc:rate:${rating}:${translationIdOf(entryId)}`);
  return entryId;
}

async function arrangeLearner(): Promise<{ telegramId: number; userId: number }> {
  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "ru", learningLangs: ["de", "en"] });
  return { telegramId, userId };
}

describe("Cards on spaced repetition (integration)", () => {
  it("C1: a due card rated Good writes SM-2, the notification grade and a review log row", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeLearner();
    const due = await seed(userId, "Anker", { easeFactor: 2.5, interval: 6, dueDate: PAST, reviewCount: 2 });

    await send(harness, telegramId, "/flashcard");
    expect(lastScreen(harness.sent).text).not.toContain(t("cardsAheadNote", "en"));
    const before = Date.now();
    await rate(harness, telegramId, "good", () => due.translationId);

    const after = await srsOf(due.entryId);
    expect(after).toMatchObject({ difficulty: "normal", easeFactor: 2.5, interval: 15, reviewCount: 3 });
    expect(after.dueDate!.getTime()).toBeGreaterThan(before + 14 * DAY_MS);
    expect(await reviewLog(due.entryId)).toEqual(["flashcard"]);
    expect(lastScreen(harness.sent).text).toContain(t("cardsDone", "en", { cards: 1, recalled: 1 }));
  });

  it("C2: with nothing due the deck practises ahead, and Good leaves the schedule untouched", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeLearner();
    const future = new Date(Date.now() + 10 * DAY_MS);
    const ahead = await seed(userId, "Hafen", { easeFactor: 2.3, interval: 12, dueDate: future, reviewCount: 4 });
    const before = await srsOf(ahead.entryId);

    await send(harness, telegramId, "/flashcard");
    expect(lastScreen(harness.sent).text).toContain(t("cardsAheadNote", "en"));
    await rate(harness, telegramId, "good", () => ahead.translationId);

    const after = await srsOf(ahead.entryId);
    expect(after).toEqual({ ...before, difficulty: "normal" });
    expect(await reviewLog(ahead.entryId)).toEqual(["flashcard"]);
  });

  it("C3: Again on an ahead card brings it back tomorrow and re-shows it once at the end, writing nothing then", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeLearner();
    const future = new Date(Date.now() + 10 * DAY_MS);
    // Lower ease sorts first among ahead cards, so the order of the deck is known.
    const weak = await seed(userId, "Leuchtturm", { easeFactor: 1.5, interval: 12, dueDate: future, reviewCount: 4 });
    const strong = await seed(userId, "Segel", { easeFactor: 2.5, interval: 12, dueDate: future, reviewCount: 4 });
    const translationIdOf = (entryId: number) => (entryId === weak.entryId ? weak.translationId : strong.translationId);

    await send(harness, telegramId, "/flashcard");
    const startedAt = Date.now();
    expect(await rate(harness, telegramId, "again", translationIdOf)).toBe(weak.entryId);

    const scheduled = await srsOf(weak.entryId);
    expect(scheduled).toMatchObject({ difficulty: "hard", interval: 1 });
    expect(scheduled.dueDate!.getTime() - startedAt).toBeGreaterThan(20 * 60 * 60 * 1000);
    expect(scheduled.dueDate!.getTime() - startedAt).toBeLessThan(28 * 60 * 60 * 1000);

    expect(await rate(harness, telegramId, "good", translationIdOf)).toBe(strong.entryId);
    expect(await rate(harness, telegramId, "good", translationIdOf)).toBe(weak.entryId);

    expect(await srsOf(weak.entryId)).toEqual(scheduled);
    expect(await reviewLog(weak.entryId)).toEqual(["flashcard"]);
    expect(lastScreen(harness.sent).text).toContain(t("cardsDone", "en", { cards: 2, recalled: 1 }));
  });

  it("C4: a word saved in two languages appears once in a deck", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeLearner();
    const entry = await vocabularyRepository.create(userId, word("Brücke", ["en", "ru"]));
    for (const translation of entry.translations) {
      await vocabularyRepository.updateSrsState(translation.id, {
        easeFactor: 2.5,
        interval: 1,
        dueDate: PAST,
        reviewCount: 1,
      });
    }

    await send(harness, telegramId, "/flashcard");

    expect(lastScreen(harness.sent).text).toContain(t("flashcardProgress", "en", { current: 1, total: 1 }));
  });

  it("C5: /review and a legacy srs:restart open the same deck; a legacy fc:next answers expired", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeLearner();
    const due = await seed(userId, "Anker", { easeFactor: 2.5, interval: 1, dueDate: PAST, reviewCount: 1 });

    await send(harness, telegramId, "/review");
    const fromCommand = lastScreen(harness.sent);
    expect(fromCommand.buttons).toEqual(["fc:reveal", "fc:quit", `fc:del:${due.entryId}`]);

    await tap(harness, telegramId, "srs:restart");
    expect(lastScreen(harness.sent)).toEqual(fromCommand);

    await tap(harness, telegramId, "fc:next");
    expect(toasts(harness.sent)).toEqual([expect.stringContaining("Session expired")]);
    expect(harness.sent.filter((call) => call.method === "editMessageText")).toEqual([]);
  });

  it("C7: removing the repeat of a word rated Again ends the deck with both cards counted, and the word leaves the dictionary", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeLearner();
    const future = new Date(Date.now() + 10 * DAY_MS);
    const weak = await seed(userId, "Leuchtturm", { easeFactor: 1.5, interval: 12, dueDate: future, reviewCount: 4 });
    const strong = await seed(userId, "Segel", { easeFactor: 2.5, interval: 12, dueDate: future, reviewCount: 4 });
    const translationIdOf = (entryId: number) => (entryId === weak.entryId ? weak.translationId : strong.translationId);

    await send(harness, telegramId, "/flashcard");
    expect(await rate(harness, telegramId, "again", translationIdOf)).toBe(weak.entryId);
    expect(await rate(harness, telegramId, "good", translationIdOf)).toBe(strong.entryId);

    // The repeat of a practice-ahead card is not ahead any more: its schedule was just set.
    const retryFront = lastScreen(harness.sent);
    expect(retryFront.text).toContain(t("flashcardProgress", "en", { current: 3, total: 3 }));
    expect(retryFront.text).not.toContain(t("cardsAheadNote", "en"));
    expect(shownEntryId(retryFront.buttons)).toBe(weak.entryId);

    await tap(harness, telegramId, `fc:del:${weak.entryId}`);

    expect(lastScreen(harness.sent).text).toContain(t("cardsDone", "en", { cards: 2, recalled: 1 }));
    const [row] = await getDb().$client<Array<{ is_active: boolean }>>`
      select is_active from vocabulary_entries where id = ${weak.entryId}
    `;
    expect(row?.is_active).toBe(false);
  });

  it("C8: Hard on a practice-ahead card halves its interval from today and keeps its review count", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeLearner();
    const future = new Date(Date.now() + 10 * DAY_MS);
    const ahead = await seed(userId, "Hafen", { easeFactor: 2.5, interval: 12, dueDate: future, reviewCount: 4 });

    await send(harness, telegramId, "/flashcard");
    const ratedAt = Date.now();
    await rate(harness, telegramId, "hard", () => ahead.translationId);

    const after = await srsOf(ahead.entryId);
    expect(after).toMatchObject({ difficulty: "hard", easeFactor: 2.35, interval: 6, reviewCount: 4 });
    // A wall-clock window rather than an instant: the rating's own clock and a DST shift both fit inside it.
    expect(Math.abs(after.dueDate!.getTime() - (ratedAt + 6 * DAY_MS))).toBeLessThan(2 * 60 * 60 * 1000);
  });

  it("C9: a second Again queued behind the first answers expired instead of rating the repeat", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeLearner();
    const due = await seed(userId, "Anker", { easeFactor: 2.5, interval: 6, dueDate: PAST, reviewCount: 2 });

    await send(harness, telegramId, "/flashcard");
    await tap(harness, telegramId, "fc:reveal");
    await tap(harness, telegramId, `fc:rate:again:${due.translationId}`);
    const scheduled = await srsOf(due.entryId);
    // The double tap: same button, same translation id, before the repeat was revealed.
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: CARD_MESSAGE_ID,
        data: `fc:rate:again:${due.translationId}`,
      }),
    );

    const screen = lastScreen(harness.sent);
    expect(screen.buttons).toContain("fc:reveal");
    expect(screen.text).not.toContain(t("cardsDone", "en", { cards: 1, recalled: 0 }));
    expect(toasts(harness.sent)).toEqual(["", expect.stringContaining("Session expired")]);
    expect(await srsOf(due.entryId)).toEqual(scheduled);
    expect(await reviewLog(due.entryId)).toEqual(["flashcard"]);
  });

  it("C6: a rating left on a card the deck moved past changes nothing", async () => {
    const harness = createBotHarness();
    const { telegramId, userId } = await arrangeLearner();
    const first = await seed(userId, "Anker", { easeFactor: 2.5, interval: 6, dueDate: PAST, reviewCount: 2 });
    const second = await seed(userId, "Hafen", {
      easeFactor: 2.5,
      interval: 6,
      dueDate: new Date(PAST.getTime() + DAY_MS),
      reviewCount: 2,
    });

    await send(harness, telegramId, "/flashcard");
    await rate(harness, telegramId, "good", () => first.translationId);
    const firstAfter = await srsOf(first.entryId);
    const secondBefore = await srsOf(second.entryId);

    await tap(harness, telegramId, `fc:rate:again:${first.translationId}`);

    expect(toasts(harness.sent)).toEqual([expect.stringContaining("Session expired")]);
    expect(await srsOf(first.entryId)).toEqual(firstAfter);
    expect(await srsOf(second.entryId)).toEqual(secondBefore);
    expect(await reviewLog(first.entryId)).toEqual(["flashcard"]);
  });
});

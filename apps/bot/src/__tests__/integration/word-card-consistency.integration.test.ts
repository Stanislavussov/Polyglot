/**
 * One card grammar across the surfaces — grammY e2e (real dispatcher, real Postgres).
 *
 * The reported defect: expanding a notification produced a differently-structured
 * card than translating the same word. The revealed card is built by the
 * dictionary renderer, which had grown a layout of its own — an input-type chrome
 * line the translate card never had, a source block repeating the headword shown
 * one line above, synonyms on a line of their own.
 *
 * The unit lane pins each renderer's output against the translate card. This file
 * covers what that cannot: the defect lived in *which* renderer a callback
 * reaches, and in what the surfaces upstream of the renderer actually hand it —
 * a session-held flashcard deck and an SRS row are different projections of the
 * same saved word, and a projection that drops a field diverges no matter how
 * faithful the renderer is.
 *
 * Every case walks a real user path: translate → save → open it from somewhere.
 */
import { vocabularyRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import type { BotHarness, CapturedCall } from "../../test-helpers/integration/bot-harness.js";
import {
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

/** The word the deterministic AI mock is fixtured for. */
const WORD = "hello";

/** `🇷🇺 RU: <b>…</b>` — the shape the translate card gives every language. */
const ANSWER_LINE = /^\S+ [A-Z]{2}: <b>[^<]+<\/b>( \([^)]+\))?$/u;

function answerLines(card: string): string[] {
  return card.split("\n").filter((line) => /^\S+ [A-Z]{2}: /u.test(line));
}

function textsOf(sent: CapturedCall[]): string[] {
  return sent
    .filter((call) => call.method === "sendMessage" || call.method === "editMessageText")
    .map((call) => String((call.payload as { text?: unknown }).text ?? ""));
}

/**
 * The most recent word card the bot sent or edited. Selected by content rather
 * than by position: the translate flow also sends chrome around the card (the
 * "detected language" notice lands after it), and only a card carries answer lines.
 */
function lastCardText(sent: CapturedCall[]): string {
  const card = textsOf(sent)
    .filter((text) => answerLines(text).length > 0)
    .at(-1);
  if (card === undefined) throw new Error("expected the bot to have rendered a word card");
  return card;
}

/** Message id + callback data of the last message carrying an inline keyboard. */
function lastKeyboard(sent: CapturedCall[]): { messageId: number; buttons: string[] } {
  const last = sent.filter((call) => (call.payload as { reply_markup?: unknown }).reply_markup !== undefined).at(-1);
  if (!last) throw new Error("expected a message carrying an inline keyboard");
  const markup = (last.payload as { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } })
    .reply_markup;
  const buttons = (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
  const messageId = last.messageId ?? Number((last.payload as { message_id?: number }).message_id ?? 0);
  return { messageId, buttons };
}

function answersOf(sent: CapturedCall[]): Array<{ text?: string }> {
  return sent.filter((call) => call.method === "answerCallbackQuery").map((call) => call.payload as { text?: string });
}

/**
 * The headword line — located by the word itself rather than by position: a
 * translate card can carry a leading notice (the detected source language) and the
 * practice surfaces carry a progress line, neither of which the others repeat.
 */
function headwordLine(card: string): string {
  const line = card.split("\n").find((candidate) => candidate.includes(`<b>${WORD}</b>`));
  if (line === undefined) throw new Error(`no headword line for "${WORD}" in:\n${card}`);
  return line;
}

/**
 * The invariant every saved-word surface owes: the word is introduced exactly as
 * the translate card introduced it, and every answer line is verbatim one of the
 * translate card's — not merely "a line mentioning the translation".
 */
function expectSameGrammarAs(translateCard: string, card: string): void {
  expect(headwordLine(card)).toBe(headwordLine(translateCard));

  const lines = answerLines(card);
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line).toMatch(ANSWER_LINE);
    expect(answerLines(translateCard)).toContain(line);
  }
  // None of the layout the stored-word cards used to add on their own.
  expect(card).not.toMatch(/<i>[^<]*·/);
}

/**
 * Translate a word and save it, returning the translate card everything else is
 * compared against plus the saved entry's id.
 *
 * A ru-native user learning English and Czech: the source is a learning language,
 * which is the reverse direction where the saved card carries a source-usage block
 * — the half that used to diverge hardest.
 */
async function arrangeSavedWord(
  harness: BotHarness,
  telegramId: number,
): Promise<{ userId: number; entryId: number; translateCard: string; lastMessageId: number }> {
  const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "ru", learningLangs: ["en", "cs"] });

  await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: WORD }));
  const translateCard = lastCardText(harness.sent);
  const { messageId } = lastRenderedCard(harness.sent);
  await harness.dispatch(
    callbackQueryUpdate({ chatId: telegramId, fromId: telegramId, messageId, data: `tr:save:${messageId}` }),
  );

  const entries = await vocabularyRepository.findByUser(userId);
  const entryId = entries[0]?.id;
  if (entryId === undefined) throw new Error("expected the saved word to be in the dictionary");

  return { userId, entryId, translateCard, lastMessageId: messageId };
}

describe("word card consistency (integration)", () => {
  it("W1: a revealed notification renders in the same grammar as the translate card", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const { entryId, translateCard, lastMessageId } = await arrangeSavedWord(harness, id);

    // A notification is a message of its own, so the callback arrives on another id.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: lastMessageId + 1, data: `notif:reveal:${entryId}` }),
    );

    expectSameGrammarAs(translateCard, lastCardText(harness.sent));
  });

  it("W2: the dictionary entry renders in the same grammar as the translate card", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const { translateCard } = await arrangeSavedWord(harness, id);

    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/dictionary" }));
    const list = lastKeyboard(harness.sent);
    const viewButton = list.buttons.find((data) => data.startsWith("dict:view:"));
    if (!viewButton) throw new Error(`expected a dict:view button, got ${list.buttons.join(", ")}`);

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: list.messageId, data: viewButton }),
    );

    expectSameGrammarAs(translateCard, lastCardText(harness.sent));
  });

  it("W3: a flashcard hides the answer on the front and reveals it in the shared grammar", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const { translateCard } = await arrangeSavedWord(harness, id);

    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/flashcard" }));
    const front = lastKeyboard(harness.sent);
    const frontText = textsOf(harness.sent).at(-1) ?? "";

    // The front is a recall prompt: the word, and none of the answers.
    expect(frontText).toContain(`<b>${WORD}</b>`);
    expect(answerLines(frontText)).toEqual([]);

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: front.messageId, data: "fc:reveal" }),
    );

    expectSameGrammarAs(translateCard, lastCardText(harness.sent));
  });

  it("W4: an SRS review names the recalled language and reveals it in the shared grammar", async () => {
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const { userId, translateCard } = await arrangeSavedWord(harness, id);

    // A freshly saved translation is scheduled for tomorrow, so make it due —
    // through the repository the rating path itself uses, not a raw UPDATE.
    const [entry] = await vocabularyRepository.findByUser(userId);
    const translationId = entry?.translations[0]?.id;
    if (translationId === undefined) throw new Error("expected a saved translation to schedule");
    await vocabularyRepository.updateSrsState(translationId, {
      easeFactor: 2.5,
      interval: 1,
      dueDate: new Date("2020-01-01T00:00:00Z"),
      reviewCount: 1,
    });

    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/review" }));
    const front = lastKeyboard(harness.sent);
    const frontText = textsOf(harness.sent).at(-1) ?? "";

    // Which language to recall is the one thing an SRS front cannot leave out.
    expect(frontText).toMatch(/<i>→ \S+ .+<\/i>/u);
    expect(answerLines(frontText)).toEqual([]);

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: front.messageId, data: "srs:reveal" }),
    );

    const back = lastCardText(harness.sent);
    expectSameGrammarAs(translateCard, back);
    // A review asks for one language, so the back promotes exactly that one.
    expect(answerLines(back)).toHaveLength(1);
  });

  it("W5: a Reveal button that outlived its word answers instead of rendering an empty card", async () => {
    // The failure branch behind every notification button: the entry was removed
    // (from the dictionary, or by retention) while the message stayed in the chat.
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const { entryId, lastMessageId } = await arrangeSavedWord(harness, id);
    const goneEntryId = entryId + 10_000_000;

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: id,
        fromId: id,
        messageId: lastMessageId + 1,
        data: `notif:reveal:${goneEntryId}`,
      }),
    );

    expect(answersOf(harness.sent).at(-1)?.text).toBe("🔍 No results found.");
    // No card, and the dead buttons are cleared rather than left tappable.
    expect(textsOf(harness.sent)).toEqual([]);
    const markupEdits = harness.sent.filter((call) => call.method === "editMessageReplyMarkup");
    expect(markupEdits.at(-1)?.payload.reply_markup).toEqual({ inline_keyboard: [] });
  });
});

/**
 * The card's hidden action list — grammY e2e integration test.
 *
 * Drives `tr:more` / `tr:less` / `tr:grammar` / `tr:say` / `tr:mentor` through the
 * real dispatcher, the real DI container and real Postgres. Only the AI boundary
 * is swapped (deterministic fixtures, as everywhere in this lane) plus the TTS
 * settings blob, which is overridden per-harness rather than written to
 * `system_settings` — that row is global and this lane runs two workers.
 *
 * What a mock-only test cannot pin down and this does:
 *  - a LONG translation (a sentence) now carries a speaker (on the card itself,
 *    not behind the fold) and a working Grammar button, both of which it used to
 *    be denied;
 *  - opening the list costs nothing — no AI call, no message rewrite;
 *  - a section generated from the list leaves the list open and retires only its
 *    own button, because every rebuild goes through the one keyboard resolver;
 *  - "Ask the mentor" persists a real two-row thread the user never typed into.
 */
import { botSessionRepository, mentorMessageRepository } from "@polyglot/adapter-db";
import { describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
  openCardActions,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";
import type { SessionData } from "../../types.js";

/** Long enough that the pipeline classifies it as a sentence, not a phrase. */
const SENTENCE = "I usually drink coffee in the morning before I go to work.";
const MENTOR_ANSWER = "The sentence uses the present simple for a habit.";

function arrangeHarness(overrides: { ttsEnabled?: boolean } = {}) {
  const generateSpeech = vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), generationId: "gen" });
  const generateChat = vi.fn().mockResolvedValue(MENTOR_ANSWER);
  const tts = {
    enabled: overrides.ttsEnabled ?? true,
    // A per-test model id keeps the globally-shared `tts_cache` from letting one
    // test's row satisfy another test's first tap.
    modelId: `test/tts-${process.pid}-${uniqueTelegramId()}`,
    voice: "Kore",
    // Comfortably above the sentence: the cap is a cost guard, not a reason for
    // a long card to lose its speaker.
    maxChars: 500,
  };
  const harness = createBotHarness({
    ai: { ...deterministicTranslateAi(), generateSpeech, generateChat },
    settings: { getTtsConfig: vi.fn().mockResolvedValue(tts) },
  });
  return { harness, generateSpeech, generateChat };
}

const tap = (harness: BotHarness, chatId: number, messageId: number, data: string) =>
  harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId, data }));

/** Text of the last card rewrite, i.e. what the user is looking at. */
function lastCardText(harness: BotHarness): string {
  const edit = harness.sent.filter((call) => call.method === "editMessageText").at(-1);
  return String(edit?.payload.text ?? "");
}

function lastMessageText(harness: BotHarness): string {
  const send = harness.sent.filter((call) => call.method === "sendMessage").at(-1);
  return String(send?.payload.text ?? "");
}

function callbackAlert(harness: BotHarness): string | undefined {
  const text = harness.sent.filter((call) => call.method === "answerCallbackQuery").at(-1)?.payload.text;
  return typeof text === "string" ? text : undefined;
}

/** Buttons of the keyboard as it stands after the most recent rebuild. */
function currentButtons(harness: BotHarness): string[] {
  const edit = harness.sent
    .filter((call) => call.method === "editMessageReplyMarkup" || call.method === "editMessageText")
    .at(-1);
  const markup = edit?.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

/** Send text and return the card's message id. */
async function sendForCard(harness: BotHarness, chatId: number, text: string): Promise<number> {
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text }));
  return lastRenderedCard(harness.sent).messageId;
}

describe("the card's hidden action list (integration)", () => {
  it("ships the card collapsed and opens the whole action list on one tap, without an AI call", async () => {
    // Arrange
    const { harness, generateChat } = arrangeHarness();
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id, { plan: "pro" }); // native en, learning cs

    // Act — a plain word card.
    const cardId = await sendForCard(harness, id, "hello");

    // Assert — a fresh card is the speaker, then the opener and the primary
    // action. Every learning aid is folded away; hearing the word is not.
    expect(lastRenderedCard(harness.sent).buttons).toEqual([
      `tr:say:cs:${cardId}`,
      `tr:more:${cardId}`,
      `tr:save:${cardId}`,
    ]);

    // Act — open the list.
    const opened = await openCardActions(harness, { chatId: id, messageId: cardId });

    // Assert — every action is now reachable and the speaker has not moved away.
    // Save is not in the menu: the list is things to read about the word, and a
    // Save at the end of it files words nobody asked to keep.
    expect(opened).toEqual(
      expect.arrayContaining([
        `tr:clarifypost:${cardId}`,
        `tr:altmeaning:${cardId}`,
        `tr:mentor:${cardId}`,
        `tr:say:cs:${cardId}`,
      ]),
    );
    expect(opened.at(-1)).toBe(`tr:less:${cardId}`);
    expect(opened).not.toContain(`tr:save:${cardId}`);
    // Opening a menu is presentation: nothing generated, nothing rewritten.
    expect(generateChat).not.toHaveBeenCalled();
    expect(harness.sent.filter((call) => call.method === "editMessageText")).toHaveLength(0);

    // Act — fold it back.
    harness.reset();
    await tap(harness, id, cardId, `tr:less:${cardId}`);

    // Assert — exactly the card the user started with.
    expect(currentButtons(harness)).toEqual([`tr:say:cs:${cardId}`, `tr:more:${cardId}`, `tr:save:${cardId}`]);
  });

  it("gives a long translation the speaker and the grammar breakdown it used to be denied", async () => {
    // Arrange — a Russian speaker learning English, so the ENGLISH sentence is the
    // card's headword: that is the case where the text handed to TTS is a whole
    // sentence rather than a single translated word.
    const { harness, generateSpeech } = arrangeHarness();
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id, { nativeLang: "ru", learningLangs: ["en"], plan: "pro" });

    // Act — a sentence, not a word.
    const cardId = await sendForCard(harness, id, SENTENCE);

    // Assert — the speaker is on the sentence card itself, no tap required.
    expect(lastRenderedCard(harness.sent).buttons).toContain(`tr:say:en:${cardId}`);

    const opened = await openCardActions(harness, { chatId: id, messageId: cardId });

    // Assert — grammar is behind the fold and offered. Etymology stays out: it is
    // a word-and-phrase aid and a sentence has no origin to trace.
    expect(opened).toContain(`tr:grammar:${cardId}`);
    expect(opened).not.toContain(`tr:etymology:${cardId}`);

    // Act — hear it.
    harness.reset();
    await tap(harness, id, cardId, `tr:say:en:${cardId}`);

    // Assert — the WHOLE sentence is synthesized and delivered, with no
    // "too long" refusal: the cap is a cost guard, not a length policy.
    expect(generateSpeech).toHaveBeenCalledTimes(1);
    expect(String(generateSpeech.mock.calls[0]![0].text)).toBe(SENTENCE);
    expect(harness.sent.filter((call) => call.method === "sendVoice")).toHaveLength(1);
    expect(callbackAlert(harness)).toBeUndefined();

    // Act — ask for the grammar.
    harness.reset();
    await tap(harness, id, cardId, `tr:grammar:${cardId}`);

    // Assert — the breakdown really lands on the card (it could not before: the
    // dynamic-key schema was refused by the provider), and the button that
    // produced it retires while the rest of the list stays open.
    expect(lastCardText(harness)).toContain("Настоящее время — привычное действие");
    expect(callbackAlert(harness)).toBeUndefined();
    const after = currentButtons(harness);
    expect(after).not.toContain(`tr:grammar:${cardId}`);
    expect(after).toContain(`tr:clarifypost:${cardId}`);
    expect(after).toContain(`tr:say:en:${cardId}`);
    expect(after).toContain(`tr:less:${cardId}`);
  });

  it("asks the mentor about the card and persists both turns of the new thread", async () => {
    // Arrange
    const { harness, generateChat } = arrangeHarness();
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, { plan: "plus" }); // mentor is a Plus feature

    const cardId = await sendForCard(harness, id, SENTENCE);
    await openCardActions(harness, { chatId: id, messageId: cardId });

    // Act
    harness.reset();
    await tap(harness, id, cardId, `tr:mentor:${cardId}`);

    // Assert — the question the user never typed carries the card's own text.
    expect(generateChat).toHaveBeenCalledTimes(1);
    const messages = generateChat.mock.calls[0]![0] as Array<{ role: string; content: string }>;
    const question = messages.at(-1)!;
    expect(question.role).toBe("user");
    expect(question.content).toContain(SENTENCE);
    expect(lastMessageText(harness)).toBe(MENTOR_ANSWER);

    // Assert — a real thread, so a reply to the answer can continue it. Both rows
    // are there: a question missing from history would leave a follow-up reading
    // an answer to nothing.
    const answerId = harness.sent.find((call) => call.payload.text === MENTOR_ANSWER)!.messageId!;
    const threadId = await mentorMessageRepository.findThreadByMessage(id, answerId);
    expect(threadId).toBeTruthy();
    const history = await mentorMessageRepository.getRecentMessages(threadId!, 10);
    expect(history.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(history[0]!.content).toContain(SENTENCE);
    expect(history[1]!.content).toBe(MENTOR_ANSWER);

    // Assert — the tap explained the card; it did not move the user into mentor
    // mode, where the next typed word would stop being translated.
    const session = await botSessionRepository.get(String(id));
    expect((session?.data as SessionData | undefined)?.activeMode).toBe("translate");
    expect(userId).toBeGreaterThan(0);
  });

  it("turns a Free user's mentor tap into the upgrade screen without calling the AI", async () => {
    // Arrange
    const { harness, generateChat } = arrangeHarness();
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id); // free plan — no mentor

    const cardId = await sendForCard(harness, id, SENTENCE);
    const opened = await openCardActions(harness, { chatId: id, messageId: cardId });
    // The button is still there and still carries its normal data — the badge is
    // cosmetic and the server-side gate is the only authority.
    expect(opened).toContain(`tr:mentor:${cardId}`);

    // Act
    harness.reset();
    await tap(harness, id, cardId, `tr:mentor:${cardId}`);

    // Assert
    expect(generateChat).not.toHaveBeenCalled();
    expect(lastMessageText(harness)).toContain("mentor");
  });

  it("renders no speaker at all while TTS is switched off", async () => {
    // Arrange
    const { harness, generateSpeech } = arrangeHarness({ ttsEnabled: false });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id, { plan: "pro" });

    // Act
    const cardId = await sendForCard(harness, id, SENTENCE);
    const fresh = lastRenderedCard(harness.sent).buttons;
    const opened = await openCardActions(harness, { chatId: id, messageId: cardId });

    // Assert — neither state invents one, and the rest of the card is unaffected.
    expect(fresh).toEqual([`tr:more:${cardId}`, `tr:save:${cardId}`]);
    expect(opened).toContain(`tr:less:${cardId}`);
    expect(opened.some((data) => data.startsWith("tr:say:"))).toBe(false);
    expect(opened).toContain(`tr:grammar:${cardId}`);
    expect(generateSpeech).not.toHaveBeenCalled();
  });

  it("tells the user the card expired when the session entry behind More is gone", async () => {
    // Arrange
    const { harness } = arrangeHarness();
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id, { plan: "pro" });

    // Act — a message id that never carried a card.
    await tap(harness, id, 999_999, "tr:more:999999");

    // Assert
    expect(callbackAlert(harness)).toBeTruthy();
    expect(harness.sent.filter((call) => call.method === "editMessageReplyMarkup")).toHaveLength(0);
  });
});

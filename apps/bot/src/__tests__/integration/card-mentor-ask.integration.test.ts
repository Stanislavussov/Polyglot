/**
 * "Ask the mentor" on a translation card — grammY e2e integration test.
 *
 * Drives the whole cross-layer flow through the real dispatcher, the real DI
 * container and real Postgres: a card → `tr:mentor` → the "what would you like
 * to clarify?" prompt → a typed question → one mentor turn that carries the card
 * with it, in mentor mode.
 *
 * What a mock-only test cannot pin down and this does:
 * - the tap costs nothing: no AI call, and `active_mode` is still `translate` in
 *   the DATABASE, so a user who ignores the prompt keeps translating;
 * - the answer arrives in mentor mode — persisted mode, pinned thread, and the
 *   exit/new-topic buttons every other mentor answer carries;
 * - the turn the model receives holds the card's own facts (the translation, its
 *   synonyms and usage note), which is the whole point of asking from a card;
 * - both rows of the new thread are persisted, so a reply continues this topic;
 * - a prompt left unanswered past the mentor idle window gives the message back
 *   to the translator instead of spending a paid turn on it.
 */
import { botSessionRepository, mentorMessageRepository, userRepository } from "@polyglot/adapter-db";
import { t } from "@polyglot/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CARD_MENTOR_CANCEL_CALLBACK, CARD_MENTOR_EXPLAIN_CALLBACK } from "../../scenes/helpers/card-mentor.js";
import { MENTOR_EXIT_CALLBACK, MENTOR_NEW_TOPIC_CALLBACK } from "../../scenes/helpers/mentor-exit.helper.js";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
  openCardActions,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";
import type { SessionData } from "../../types.js";

const WORD = "hello";
const QUESTION = "when is it too informal?";
const MENTOR_ANSWER = "It is fine everywhere except a formal letter.";
const ASK_PROMPT = t("cardMentorAskPrompt", "en", { text: WORD });
/** Past the 15-minute mentor idle window the prompt borrows for its own staleness. */
const MINUTE_MS = 60_000;
const PROMPT_AT = new Date("2026-04-02T08:00:00.000Z");
const STALE_AT = new Date(PROMPT_AT.getTime() + 16 * MINUTE_MS);

const sends = (harness: BotHarness): CapturedCall[] => harness.sent.filter((call) => call.method === "sendMessage");

const tap = (harness: BotHarness, chatId: number, messageId: number, data: string) =>
  harness.dispatch(callbackQueryUpdate({ chatId, fromId: chatId, messageId, data }));

function callbackData(call: CapturedCall | undefined): string[] {
  const markup = call?.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

async function readSession(chatId: number): Promise<SessionData> {
  const row = await botSessionRepository.get(String(chatId));
  if (!row) throw new Error(`no session persisted for chat ${chatId}`);
  return row.data as SessionData;
}

/** A translated card with its "Ask the mentor" prompt open. */
async function arrangeOpenPrompt(plan: "plus" | "free" = "plus") {
  const generateChat = vi.fn().mockResolvedValue(MENTOR_ANSWER);
  const harness = createBotHarness({ ai: { ...deterministicTranslateAi(), generateChat } });
  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId, { plan });

  await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: WORD, messageId: 10 }));
  const cardId = lastRenderedCard(harness.sent).messageId;
  await openCardActions(harness, { chatId: telegramId, messageId: cardId });

  harness.reset();
  await tap(harness, telegramId, cardId, `tr:mentor:${cardId}`);
  const promptCall = sends(harness).at(-1);

  return { harness, generateChat, telegramId, userId, cardId, promptCall };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("asking the mentor about a card (integration)", () => {
  it("asks what to clarify, then answers it in mentor mode with the card attached", async () => {
    const { harness, generateChat, telegramId, userId, cardId, promptCall } = await arrangeOpenPrompt();

    // Assert — the tap bought a question, not a turn.
    expect(promptCall?.payload.text).toBe(ASK_PROMPT);
    expect(callbackData(promptCall)).toEqual([CARD_MENTOR_EXPLAIN_CALLBACK, CARD_MENTOR_CANCEL_CALLBACK]);
    expect(generateChat).not.toHaveBeenCalled();
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("translate");
    const armed = await readSession(telegramId);
    expect(armed.pendingCardMentorAsk).toMatchObject({ cardMsgId: cardId, promptMsgId: promptCall?.messageId });

    // Act — the question.
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: QUESTION, messageId: 11 }));

    // Assert — one turn, carrying the card the user is looking at.
    expect(generateChat).toHaveBeenCalledTimes(1);
    const messages = generateChat.mock.calls[0]![0] as Array<{ role: string; content: string }>;
    const turn = messages.at(-1)!;
    expect(turn.role).toBe("user");
    expect(turn.content).toContain(`Original input: ${WORD}`);
    expect(turn.content).toContain("Translation into cs: ahoj");
    expect(turn.content).toContain("usage note: informal greeting");
    expect(turn.content).toContain('examples: "Ahoj!"');
    expect(turn.content.endsWith(QUESTION)).toBe(true);

    // Assert — the answer is a mentor answer: mentor mode, with the buttons that
    // only ride on answers delivered IN that mode.
    const answer = sends(harness).find((call) => call.payload.text === MENTOR_ANSWER);
    expect(answer).toBeDefined();
    expect(callbackData(answer)).toEqual([MENTOR_NEW_TOPIC_CALLBACK, MENTOR_EXIT_CALLBACK]);
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("mentor");

    // Assert — a real thread with both rows, so a reply continues this topic.
    const threadId = await mentorMessageRepository.findThreadByMessage(telegramId, answer!.messageId!);
    expect(threadId).toBeTruthy();
    const history = await mentorMessageRepository.getRecentMessages(threadId!, 10);
    expect(history.map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(history[0]!.content).toContain(QUESTION);
    expect(history[1]!.content).toBe(MENTOR_ANSWER);

    const session = await readSession(telegramId);
    expect(session.activeMode).toBe("mentor");
    expect(session.mentor?.threadId).toBe(threadId);
    expect(session.pendingCardMentorAsk).toBeUndefined();
  });

  it("runs the card's own question on 'Just explain it'", async () => {
    const { harness, generateChat, telegramId, userId, promptCall } = await arrangeOpenPrompt();

    harness.reset();
    await tap(harness, telegramId, promptCall?.messageId ?? 0, CARD_MENTOR_EXPLAIN_CALLBACK);

    expect(generateChat).toHaveBeenCalledTimes(1);
    const messages = generateChat.mock.calls[0]![0] as Array<{ role: string; content: string }>;
    expect(messages.at(-1)!.content).toContain(`Original input: ${WORD}`);
    expect(messages.at(-1)!.content).toContain(t("cardMentorQuestion", "en", { text: WORD, lang: "English" }));
    expect(sends(harness).some((call) => call.payload.text === MENTOR_ANSWER)).toBe(true);
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("mentor");
    expect((await readSession(telegramId)).pendingCardMentorAsk).toBeUndefined();
  });

  it("drops the prompt on Cancel and leaves the user translating", async () => {
    const { harness, generateChat, telegramId, userId, promptCall } = await arrangeOpenPrompt();

    harness.reset();
    await tap(harness, telegramId, promptCall?.messageId ?? 0, CARD_MENTOR_CANCEL_CALLBACK);

    const edit = harness.sent.find((call) => call.method === "editMessageText");
    expect(edit?.payload.text).toBe(t("cardMentorAskCancelled", "en"));
    expect(generateChat).not.toHaveBeenCalled();
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("translate");

    // The next word is translated, not sent to the mentor.
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "bye", messageId: 12 }));
    expect(lastRenderedCard(harness.sent).messageId).toBeGreaterThan(0);
    expect(generateChat).not.toHaveBeenCalled();
    expect((await readSession(telegramId)).pendingCardMentorAsk).toBeUndefined();
  });

  it("gives a long-forgotten prompt's message back to the translator", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(PROMPT_AT);
    const { harness, generateChat, telegramId, userId } = await arrangeOpenPrompt();

    vi.setSystemTime(STALE_AT);
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "bye", messageId: 13 }));

    // A word typed 16 minutes later is a word to translate, not an answer to a
    // question the user has forgotten — and guessing wrong spends a paid turn.
    expect(generateChat).not.toHaveBeenCalled();
    expect(lastRenderedCard(harness.sent).messageId).toBeGreaterThan(0);
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("translate");
    expect((await readSession(telegramId)).pendingCardMentorAsk).toBeUndefined();
  });

  it("turns a Free user's tap into the upgrade screen, with no prompt to answer", async () => {
    const { harness, generateChat, telegramId, promptCall } = await arrangeOpenPrompt("free");

    expect(promptCall?.payload.text).not.toBe(ASK_PROMPT);
    expect(String(promptCall?.payload.text)).toContain("mentor");
    expect(generateChat).not.toHaveBeenCalled();
    expect((await readSession(telegramId)).pendingCardMentorAsk).toBeUndefined();

    // The next message is still an ordinary translation.
    harness.reset();
    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "bye", messageId: 14 }));
    expect(lastRenderedCard(harness.sent).messageId).toBeGreaterThan(0);
    expect(generateChat).not.toHaveBeenCalled();
  });
});

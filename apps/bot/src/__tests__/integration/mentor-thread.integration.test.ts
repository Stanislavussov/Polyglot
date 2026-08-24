/**
 * Mentor mode with reply-thread context — grammY e2e integration test.
 *
 * Drives the full flow through the real dispatcher, DI container, and Postgres:
 * /mentor starts a thread, plain messages in mentor mode continue it (history
 * reaches the AI), a reply to an old mentor answer continues THAT thread even
 * from translate mode, and a reply to a non-mentor bot message still translates.
 * The paid gate is exercised on the real plan matrix: free is refused at
 * /mentor without ever touching the mode or the AI.
 *
 * What a mock-only test cannot pin down and this does: that the
 * (chat_id, telegram_message_id) → thread mapping survives the real send path
 * (the id the bot ACTUALLY got back from sendMessage is the one recorded), and
 * that the mode-router precedence leaves ordinary translation untouched.
 */
import { mentorMessageRepository, userRepository } from "@polyglot/adapter-db";
import { describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  createBotHarness,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

type ChatMsg = { role: string; content: string };

function arrangeHarness() {
  const generateChat = vi.fn().mockResolvedValue("Present Perfect links a past event to now.");
  const harness = createBotHarness({ ai: { ...deterministicTranslateAi(), generateChat } });
  return { harness, generateChat };
}

const sends = (harness: BotHarness): CapturedCall[] => harness.sent.filter((call) => call.method === "sendMessage");

/** The captured sendMessage call whose text is the given mentor answer, with its assigned message id. */
function answerMessageId(harness: BotHarness, text: string): number {
  const call = sends(harness).find((candidate) => candidate.payload.text === text);
  if (call?.messageId === undefined) throw new Error(`no sendMessage captured with text: ${text}`);
  return call.messageId;
}

describe("mentor mode with reply threads (integration)", () => {
  it("runs a mentor conversation, persists the thread, and continues it via reply from translate mode", async () => {
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId, { plan: "plus" });
    const { harness, generateChat } = arrangeHarness();

    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/mentor" }));
    await harness.dispatch(
      messageUpdate({ chatId: telegramId, fromId: telegramId, text: "how does Present Perfect work?", messageId: 11 }),
    );

    // The turn ran on the admin-managed mentor model (settings blob default),
    // not the registry default the translate pipeline resolves to.
    expect(generateChat.mock.calls[0][1]).toBe("google/gemini-3.7-flash");

    // The answer reached the user and both turn rows share one thread, the
    // assistant row keyed by the REAL message id the harness assigned to the send.
    const answerId = answerMessageId(harness, "Present Perfect links a past event to now.");
    const threadId = await mentorMessageRepository.findThreadByMessage(telegramId, answerId);
    expect(threadId).not.toBeNull();
    expect(await mentorMessageRepository.getRecentMessages(threadId as string, 10)).toEqual([
      { role: "user", content: "how does Present Perfect work?" },
      { role: "assistant", content: "Present Perfect links a past event to now." },
    ]);

    // A second plain message in mentor mode continues the same thread: the AI
    // fake sees the first turn as history.
    generateChat.mockResolvedValueOnce("With since/for it marks duration.");
    await harness.dispatch(
      messageUpdate({ chatId: telegramId, fromId: telegramId, text: "and with since/for?", messageId: 12 }),
    );
    const secondCallMessages = generateChat.mock.calls[1][0] as ChatMsg[];
    expect(secondCallMessages.map((message) => message.content)).toContain("how does Present Perfect work?");
    expect(secondCallMessages.at(-1)).toEqual({ role: "user", content: "and with since/for?" });

    // Leave mentor mode; a plain word goes to translation again.
    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/translate" }));
    const settings = await userRepository.getSettings(userId);
    expect(settings?.activeMode).toBe("translate");

    // A reply to the OLD mentor answer continues that thread — mode stays translate.
    generateChat.mockResolvedValueOnce("In questions the auxiliary moves first.");
    await harness.dispatch(
      messageUpdate({
        chatId: telegramId,
        fromId: telegramId,
        text: "and in questions?",
        messageId: 13,
        replyToMessageId: answerId,
      }),
    );
    const replyCallMessages = generateChat.mock.calls[2][0] as ChatMsg[];
    expect(replyCallMessages.map((message) => message.content)).toContain("how does Present Perfect work?");
    expect(replyCallMessages.at(-1)).toEqual({ role: "user", content: "and in questions?" });
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("translate");
    // The reply-continuation turn was persisted into the same thread.
    expect((await mentorMessageRepository.getRecentMessages(threadId as string, 10)).length).toBe(6);
  });

  it("a reply to a non-mentor bot message falls through to translation", async () => {
    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId, { plan: "plus" });
    const { harness, generateChat } = arrangeHarness();

    // The bot's /translate confirmation is a real bot message with no mentor row.
    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/translate" }));
    const confirmation = sends(harness).at(-1);
    expect(confirmation?.messageId).toBeDefined();

    await harness.dispatch(
      messageUpdate({
        chatId: telegramId,
        fromId: telegramId,
        text: "hello",
        messageId: 21,
        replyToMessageId: confirmation?.messageId,
      }),
    );

    // Translation ran (the deterministic translate AI produced a card); the chat AI did not.
    expect(generateChat).not.toHaveBeenCalled();
    expect(
      harness.sent.some((call) => call.method === "editMessageText" || call.method === "editMessageReplyMarkup"),
    ).toBe(true);
  });

  it("a second /mentor starts a fresh thread", async () => {
    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId, { plan: "plus" });
    const { harness, generateChat } = arrangeHarness();

    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/mentor" }));
    generateChat.mockResolvedValueOnce("First thread answer.");
    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "topic one", messageId: 31 }));
    const firstAnswerId = answerMessageId(harness, "First thread answer.");
    const firstThread = await mentorMessageRepository.findThreadByMessage(telegramId, firstAnswerId);

    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/mentor" }));
    generateChat.mockResolvedValueOnce("Second thread answer.");
    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "topic two", messageId: 32 }));
    const secondAnswerId = answerMessageId(harness, "Second thread answer.");
    const secondThread = await mentorMessageRepository.findThreadByMessage(telegramId, secondAnswerId);

    expect(firstThread).not.toBeNull();
    expect(secondThread).not.toBeNull();
    expect(secondThread).not.toBe(firstThread);
    // The fresh thread's AI call carried no history from the first one.
    const secondCallMessages = generateChat.mock.calls[1][0] as ChatMsg[];
    expect(secondCallMessages.map((message) => message.content)).not.toContain("topic one");
  });

  it("caps mentor turns at the plan's daily limit and sells Pro on the refusal", async () => {
    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId, { plan: "plus" });
    const generateChat = vi.fn().mockResolvedValue("Allowed answer.");
    const harness = createBotHarness({
      ai: { ...deterministicTranslateAi(), generateChat },
      settings: {
        getPlanLimit: vi.fn().mockResolvedValue({
          name: "plus",
          label: "Plus",
          translationLimit: null,
          creditCost: 1,
          videoLimit: 20,
          videoWindow: "monthly",
          mentorDailyLimit: 1,
          priceUsdCents: 500,
          isActive: true,
          isDefault: false,
        }),
      },
    });

    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/mentor" }));
    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "first", messageId: 51 }));
    expect(generateChat).toHaveBeenCalledTimes(1);

    // Second turn of the day: refused before any AI call, with the limit named
    // and the upgrade CTA attached.
    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "second", messageId: 52 }));
    expect(generateChat).toHaveBeenCalledTimes(1);
    const refusal = sends(harness).at(-1);
    expect(String(refusal?.payload.text)).toContain("1");
    const markup = refusal?.payload.reply_markup as
      | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
      | undefined;
    const buttons = (markup?.inline_keyboard ?? []).flat().map((button) => button.callback_data);
    expect(buttons).toContain("plan:upgrade");
  });

  it("refuses /mentor on the free plan without touching the mode, and gates the reply path too", async () => {
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId);
    const { harness, generateChat } = arrangeHarness();

    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/mentor" }));

    // Refused: upgrade screen with buy buttons, mode untouched, no AI call.
    const lastSend = sends(harness).at(-1);
    const markup = lastSend?.payload.reply_markup as
      | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
      | undefined;
    const buttons = (markup?.inline_keyboard ?? []).flat().map((button) => button.callback_data);
    expect(buttons.some((data) => typeof data === "string" && data.startsWith("plan:buy:"))).toBe(true);
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("translate");
    expect(generateChat).not.toHaveBeenCalled();

    // A free user replying to a mentor answer from a paid period is gated on the turn.
    const threadId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await mentorMessageRepository.record({
      userId,
      chatId: telegramId,
      threadId,
      role: "assistant",
      content: "an old paid-era answer",
      telegramMessageId: 900_001,
    });
    await harness.dispatch(
      messageUpdate({
        chatId: telegramId,
        fromId: telegramId,
        text: "continue please",
        messageId: 41,
        replyToMessageId: 900_001,
      }),
    );
    expect(generateChat).not.toHaveBeenCalled();
    // Nothing was appended to the thread.
    expect((await mentorMessageRepository.getRecentMessages(threadId, 10)).length).toBe(1);
  });
});

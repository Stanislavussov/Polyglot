import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Partial mock: the real MENTOR_MAX_INPUT_LENGTH is the boundary under test.
vi.mock("./mentor-mode.helper.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mentor-mode.helper.js")>()),
  handleMentorText: vi.fn().mockResolvedValue(undefined),
}));

import { getLanguageName, type ServiceContainer, type TranslateOutput, t } from "@polyglot/core";
import { createServicesStub } from "../../test-helpers/services-stub.js";
import type { BotContext, SessionData } from "../../types.js";
import {
  CARD_MENTOR_CANCEL_CALLBACK,
  CARD_MENTOR_EXPLAIN_CALLBACK,
  handleCardMentorCallback,
  handleCardMentorCancelCallback,
  handleCardMentorExplainCallback,
  tryHandleCardMentorQuestion,
} from "./card-mentor.js";
import { handleMentorText, MENTOR_MAX_INPUT_LENGTH } from "./mentor-mode.helper.js";

const NOW = new Date("2026-03-04T10:00:00.000Z");
const MINUTE = 60_000;
const CHAT_ID = 42_042;
const CARD_MSG_ID = 300;
const PROMPT_MSG_ID = 301;
const USER_MSG_ID = 302;

const OUTPUT: TranslateOutput = {
  original: "arbeit",
  sourceLang: "de",
  nativeMeaning: "work",
  sourceUsage: { headword: "die Arbeit", explanation: "A job or the activity.", synonyms: [], examples: [] },
  nativeSynonyms: [],
  translations: { cs: { text: "práce", synonyms: [], examples: [] } },
};

function createMockCtx(overrides: Partial<SessionData> = {}): BotContext {
  const session = {
    activeMode: "translate",
    translationMap: {
      [String(CARD_MSG_ID)]: { output: OUTPUT, inputType: "word", contextHint: "as in a paid job" },
    },
    ...overrides,
  } as SessionData;
  const userRepository = {
    getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en", nativeLang: "en", learningLangs: ["cs"] }),
    updateActiveMode: vi.fn().mockResolvedValue({}),
  } as unknown as ServiceContainer["userRepository"];

  return {
    chat: { id: CHAT_ID },
    message: { message_id: USER_MSG_ID, text: "why is it feminine?" },
    callbackQuery: { data: `tr:mentor:${CARD_MSG_ID}` },
    session,
    user: { id: 7, telegramId: CHAT_ID, onboarded: true, subscriptionPlan: "plus" },
    reply: vi.fn().mockResolvedValue({ message_id: PROMPT_MSG_ID }),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    api: { deleteMessage: vi.fn().mockResolvedValue(true) },
    services: createServicesStub({ userRepository }),
  } as unknown as BotContext;
}

function promptButtons(ctx: BotContext): (string | undefined)[] {
  const [, extra] = vi.mocked(ctx.reply).mock.calls[0]!;
  const rows = extra?.reply_markup && "inline_keyboard" in extra.reply_markup ? extra.reply_markup.inline_keyboard : [];
  return (rows[0] ?? []).map((button) => ("callback_data" in button ? button.callback_data : undefined));
}

/** The composed turn text handed to the mentor. */
function mentorTurnText(): string {
  return String(vi.mocked(handleMentorText).mock.calls[0]![1]);
}

const armed = (askedAt: number = NOW.getTime()) => ({
  pendingCardMentorAsk: { cardMsgId: CARD_MSG_ID, promptMsgId: PROMPT_MSG_ID, askedAt },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handleCardMentorCallback", () => {
  it("asks what to clarify instead of spending a turn, and leaves the mode alone", async () => {
    const ctx = createMockCtx();

    await handleCardMentorCallback(ctx);

    // The prompt names the card's citation form, so the user knows which word is on the table.
    expect(String(vi.mocked(ctx.reply).mock.calls[0]![0])).toContain("die Arbeit");
    expect(promptButtons(ctx)).toEqual([CARD_MENTOR_EXPLAIN_CALLBACK, CARD_MENTOR_CANCEL_CALLBACK]);
    expect(ctx.session.pendingCardMentorAsk).toEqual({
      cardMsgId: CARD_MSG_ID,
      promptMsgId: PROMPT_MSG_ID,
      askedAt: NOW.getTime(),
    });
    expect(handleMentorText).not.toHaveBeenCalled();
    // Nothing moves until there is a question: a user who ignores the prompt is
    // still in translate mode and their next word is still translated.
    expect(ctx.session.activeMode).toBe("translate");
    expect(ctx.services.userRepository.updateActiveMode).not.toHaveBeenCalled();
  });

  it("answers a tap on an expired card with the stale alert and arms nothing", async () => {
    const ctx = createMockCtx({ translationMap: {} });

    await handleCardMentorCallback(ctx);

    expect(vi.mocked(ctx.answerCallbackQuery).mock.calls[0]![0]).toMatchObject({ show_alert: true });
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.session.pendingCardMentorAsk).toBeUndefined();
  });

  it("leaves exactly one live prompt when a second card is asked about", async () => {
    const ctx = createMockCtx(armed());

    await handleCardMentorCallback(ctx);

    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(CHAT_ID, PROMPT_MSG_ID);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
  });
});

describe("tryHandleCardMentorQuestion", () => {
  it("sends the question with the whole card attached and enters mentor mode", async () => {
    const ctx = createMockCtx(armed());

    expect(await tryHandleCardMentorQuestion(ctx, "why is it feminine?")).toBe(true);

    const turn = mentorTurnText();
    expect(turn).toContain("die Arbeit");
    expect(turn).toContain("Translation into cs: práce");
    expect(turn).toContain("as in a paid job");
    expect(turn.endsWith("why is it feminine?")).toBe(true);

    const opts = vi.mocked(handleMentorText).mock.calls[0]![2];
    // The length guard measures the typed question, not the card the bot attached.
    expect(opts?.userInput).toBe("why is it feminine?");
    expect(opts?.userMessageId).toBe(USER_MSG_ID);
    // A fresh thread: the card is a new subject, not a continuation of whatever was open.
    expect(opts?.threadId).toBeTruthy();

    expect(ctx.session.activeMode).toBe("mentor");
    expect(ctx.services.userRepository.updateActiveMode).toHaveBeenCalledWith(7, "mentor");
    expect(ctx.session.pendingCardMentorAsk).toBeUndefined();
  });

  it("keeps the prompt armed when the question is too long to send", async () => {
    const ctx = createMockCtx(armed());

    expect(await tryHandleCardMentorQuestion(ctx, "x".repeat(MENTOR_MAX_INPUT_LENGTH + 1))).toBe(true);

    expect(handleMentorText).not.toHaveBeenCalled();
    // Armed, so the shortened retry still reaches the mentor instead of the translator.
    expect(ctx.session.pendingCardMentorAsk).toBeDefined();
    expect(ctx.session.activeMode).toBe("translate");
  });

  it("gives the message back to the router once the prompt has gone stale", async () => {
    const ctx = createMockCtx(armed(NOW.getTime() - 16 * MINUTE));

    expect(await tryHandleCardMentorQuestion(ctx, "hello")).toBe(false);

    expect(handleMentorText).not.toHaveBeenCalled();
    expect(ctx.session.pendingCardMentorAsk).toBeUndefined();
    expect(ctx.session.activeMode).toBe("translate");
  });

  it("stays out of the way when no prompt is armed", async () => {
    const ctx = createMockCtx();

    expect(await tryHandleCardMentorQuestion(ctx, "hello")).toBe(false);
    expect(handleMentorText).not.toHaveBeenCalled();
  });

  it("still answers the question when the card itself has been evicted", async () => {
    const ctx = createMockCtx({ ...armed(), translationMap: {} });

    expect(await tryHandleCardMentorQuestion(ctx, "why is it feminine?")).toBe(true);

    expect(mentorTurnText()).toBe("why is it feminine?");
    expect(ctx.session.activeMode).toBe("mentor");
  });
});

describe("handleCardMentorExplainCallback", () => {
  it("asks the card's own question and enters mentor mode", async () => {
    const ctx = createMockCtx(armed());

    await handleCardMentorExplainCallback(ctx);

    const turn = mentorTurnText();
    expect(turn).toContain("die Arbeit");
    // The card's own question, verbatim — the one-tap explanation this button
    // used to give on its own, now with the card attached to it.
    const canned = t("cardMentorQuestion", "en", { text: "die Arbeit", lang: getLanguageName("de", "en") });
    expect(turn.endsWith(canned)).toBe(true);
    // Anchored to the card: nothing was typed, so the thread would otherwise hold
    // an answer to no question at all.
    expect(vi.mocked(handleMentorText).mock.calls[0]![2]?.userMessageId).toBe(CARD_MSG_ID);
    expect(ctx.session.activeMode).toBe("mentor");
    expect(ctx.session.pendingCardMentorAsk).toBeUndefined();
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalled();
  });

  it("answers a tap with nothing behind it with the stale alert", async () => {
    const ctx = createMockCtx();

    await handleCardMentorExplainCallback(ctx);

    expect(vi.mocked(ctx.answerCallbackQuery).mock.calls[0]![0]).toMatchObject({ show_alert: true });
    expect(handleMentorText).not.toHaveBeenCalled();
    expect(ctx.session.activeMode).toBe("translate");
  });
});

describe("handleCardMentorCancelCallback", () => {
  it("drops the prompt in place and leaves the user where they were", async () => {
    const ctx = createMockCtx(armed());

    await handleCardMentorCancelCallback(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    expect(ctx.session.pendingCardMentorAsk).toBeUndefined();
    expect(handleMentorText).not.toHaveBeenCalled();
    expect(ctx.session.activeMode).toBe("translate");
    expect(ctx.services.userRepository.updateActiveMode).not.toHaveBeenCalled();
  });
});

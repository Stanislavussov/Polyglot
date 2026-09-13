/**
 * Mentor idle re-confirm prompt — grammY e2e integration test (Task 83, T6).
 *
 * Drives the whole cross-layer flow through the real dispatcher, the real DI
 * container and Postgres: `/mentor` → a mentor turn → a 16-minute silence → a
 * plain message that is HELD behind the two-button prompt instead of spending a
 * paid turn, and then each of the two answers plus both stale variants.
 *
 * What a mock-only test cannot pin down and this does:
 * - the completed turn leaves BOTH `mentor.threadId` and an advanced
 *   `mentor.lastTurnAt` in the PERSISTED session row (the whole-object-write
 *   regression the plan calls A2 — a mock session object would hide it);
 * - "Stay" resumes the held text in the SAME thread and persists the resumed
 *   user row, so the thread holds 4 rows and no second thread is minted;
 * - "Switch" takes the hold BEFORE `activateTranslateMode` clears the slot, so
 *   the held text still reaches the translate pipeline.
 *
 * Time is driven with `vi.setSystemTime` over a Date-only fake, as in
 * `momentum-surfaces.integration.test.ts`: full fake timers stall the Postgres
 * driver's internal waits. `mentor_messages.createdAt` is `defaultNow()` — a
 * Postgres clock this fake never moves — so nothing here asserts on timestamps
 * or timestamp ordering; thread identity and row counts carry the meaning.
 */
import { botSessionRepository, mentorMessageRepository, userRepository } from "@polyglot/adapter-db";
import { type AIPort, t } from "@polyglot/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MENTOR_IDLE_EXIT_CALLBACK, MENTOR_IDLE_STAY_CALLBACK } from "../../scenes/helpers/mentor-idle.helper.js";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
  voiceMessageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";
import type { SessionData } from "../../types.js";

const MINUTE_MS = 60_000;
/** `/mentor` lands here; every later instant is an offset from it. */
const ENTRY_AT = new Date("2026-07-08T09:00:00.000Z");
/** The first turn runs a minute later, so an unadvanced `lastTurnAt` is visible. */
const TURN_AT = new Date(ENTRY_AT.getTime() + MINUTE_MS);
/** Past the 15-minute `MODE_POLICIES.mentor.idleTimeoutMs`, measured from the turn. */
const IDLE_AT = new Date(TURN_AT.getTime() + 16 * MINUTE_MS);

const FIRST_QUESTION = "how does Present Perfect work?";
const FIRST_ANSWER = "Present Perfect links a past event to now.";
const RESUMED_ANSWER = "Sure — here is more on that.";
/** The held message: a plain word, so the Switch branch produces a real card. */
const HELD_TEXT = "hello";
/** What the speech-to-text model returns for the held voice message. */
const SPOKEN_TEXT = "and in main clauses?";

const IDLE_QUESTION = t("mentorIdleQuestion", "en");
/** The mode-switch confirmation up to its language pair, which is display-name formatted. */
const TRANSLATE_RETURNED_PREFIX = t("translateModeReturned", "en", { fromLang: "", toLangs: "" }).split("(")[0]!.trim();

const sends = (harness: BotHarness): CapturedCall[] => harness.sent.filter((call) => call.method === "sendMessage");

function callbackData(call: CapturedCall | undefined): string[] {
  const markup = call?.payload.reply_markup as
    | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
    | undefined;
  return (markup?.inline_keyboard ?? [])
    .flat()
    .map((button) => button.callback_data)
    .filter((data): data is string => typeof data === "string");
}

/**
 * The deterministic translate AI, with every prompt it is handed recorded.
 *
 * A `vi.fn()` wrapper cannot stand in for `generateObject`: the port method is
 * generic in its schema, and a mock erases that to `unknown`. A typed arrow keeps
 * the generic and gives the same evidence — which prompts reached the pipeline.
 */
function recordingTranslateAi(): { ai: Partial<AIPort>; prompts: string[] } {
  const base = deterministicTranslateAi();
  const generate = base.generateObject;
  if (!generate) throw new Error("deterministicTranslateAi provided no generateObject");
  const prompts: string[] = [];
  const generateObject: AIPort["generateObject"] = (prompt, schema, model, options) => {
    prompts.push(prompt);
    return generate(prompt, schema, model, options);
  };
  return { ai: { ...base, generateObject }, prompts };
}

async function readSession(chatId: number): Promise<SessionData> {
  const row = await botSessionRepository.get(String(chatId));
  if (!row) throw new Error(`no session persisted for chat ${chatId}`);
  return row.data as SessionData;
}

interface ArrangedPrompt {
  harness: BotHarness;
  generateChat: ReturnType<typeof vi.fn>;
  /** Every prompt the translate pipeline sent, in order. */
  translatePrompts: string[];
  telegramId: number;
  userId: number;
  /** `lastTurnAt` written by `/mentor`, before any turn advanced it. */
  entryStamp: number | undefined;
  /** Session as persisted right after the first completed turn. */
  afterTurn: SessionData;
  /** Thread the first turn opened, read back from `mentor_messages`. */
  threadId: string;
  /** Everything the bot sent while answering the idle message. */
  idleSends: CapturedCall[];
  /** The prompt message, with the id the harness assigned to its `sendMessage`. */
  promptCall: CapturedCall;
}

/**
 * Replays the full road to an open idle prompt for a brand-new user: `/mentor`,
 * one answered turn, a 16-minute silence, then the message that gets held.
 *
 * Every `it` calls this for its own `uniqueTelegramId()` — the lane never
 * truncates, so a fresh user per test IS the isolation.
 */
async function arrangeIdlePrompt(): Promise<ArrangedPrompt> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ENTRY_AT);

  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId, { plan: "plus" });

  const { ai, prompts: translatePrompts } = recordingTranslateAi();
  const generateChat = vi.fn().mockResolvedValue(FIRST_ANSWER);
  const harness = createBotHarness({ ai: { ...ai, generateChat } });

  await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/mentor" }));
  const entryStamp = (await readSession(telegramId)).mentor?.lastTurnAt;

  vi.setSystemTime(TURN_AT);
  harness.reset();
  await harness.dispatch(
    messageUpdate({ chatId: telegramId, fromId: telegramId, text: FIRST_QUESTION, messageId: 11 }),
  );
  const answer = sends(harness).find((call) => call.payload.text === FIRST_ANSWER);
  if (answer?.messageId === undefined) throw new Error("the first mentor turn produced no answer message");
  const threadId = await mentorMessageRepository.findThreadByMessage(telegramId, answer.messageId);
  if (!threadId) throw new Error("the first mentor turn persisted no thread");
  const afterTurn = await readSession(telegramId);

  vi.setSystemTime(IDLE_AT);
  harness.reset();
  await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: HELD_TEXT, messageId: 12 }));
  const idleSends = sends(harness);
  const promptCall = idleSends.at(-1);
  if (!promptCall) throw new Error("no message was sent for the idle text");

  return {
    harness,
    generateChat,
    translatePrompts,
    telegramId,
    userId,
    entryStamp,
    afterTurn,
    threadId,
    idleSends,
    promptCall,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("mentor idle prompt (integration)", () => {
  it("stamps the completed turn, holds the next message after a 16-minute silence, and resumes it on Stay", async () => {
    const { harness, generateChat, telegramId, userId, entryStamp, afterTurn, threadId, idleSends, promptCall } =
      await arrangeIdlePrompt();

    // The completed turn left BOTH the thread pin and an advanced stamp in the
    // PERSISTED session — the whole-object write that used to drop `lastTurnAt`
    // would make every later message look idle.
    expect(entryStamp).toBe(ENTRY_AT.getTime());
    expect(afterTurn.mentor?.threadId).toBe(threadId);
    expect(afterTurn.mentor?.lastTurnAt).toBe(TURN_AT.getTime());
    expect(afterTurn.mentor?.lastTurnAt ?? 0).toBeGreaterThan(entryStamp ?? 0);

    // The idle message bought exactly one bot message — the prompt — and no
    // second paid turn.
    expect(idleSends).toHaveLength(1);
    expect(promptCall.payload.text).toBe(IDLE_QUESTION);
    expect(callbackData(promptCall)).toEqual([MENTOR_IDLE_STAY_CALLBACK, MENTOR_IDLE_EXIT_CALLBACK]);
    expect(generateChat).toHaveBeenCalledTimes(1);

    // The held text and the prompt's REAL message id are in the persisted session.
    const held = await readSession(telegramId);
    expect(held.mentorIdlePrompt?.text).toBe(HELD_TEXT);
    expect(held.mentorIdlePrompt?.promptMsgId).toBe(promptCall.messageId);
    expect(held.mentorIdlePrompt?.userMsgId).toBe(12);

    // Act: Stay → the held text runs as a mentor turn in the SAME thread.
    generateChat.mockResolvedValueOnce(RESUMED_ANSWER);
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: promptCall.messageId ?? 0,
        data: MENTOR_IDLE_STAY_CALLBACK,
      }),
    );

    expect(generateChat).toHaveBeenCalledTimes(2);
    const resumedMessages = generateChat.mock.calls[1]?.[0] as Array<{ role: string; content: string }>;
    expect(resumedMessages.at(-1)).toEqual({ role: "user", content: HELD_TEXT });
    expect(sends(harness).some((call) => call.payload.text === RESUMED_ANSWER)).toBe(true);

    // Two turns × (user row + assistant row), all under the one thread — the
    // resumed user row exists only because the hold carried its message id.
    expect(await mentorMessageRepository.getRecentMessages(threadId, 10)).toEqual([
      { role: "user", content: FIRST_QUESTION },
      { role: "assistant", content: FIRST_ANSWER },
      { role: "user", content: HELD_TEXT },
      { role: "assistant", content: RESUMED_ANSWER },
    ]);
    expect(await mentorMessageRepository.findLatestThreadId(telegramId)).toBe(threadId);

    // Mode untouched, hold consumed, pin intact.
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("mentor");
    const resumed = await readSession(telegramId);
    expect(resumed.mentorIdlePrompt).toBeUndefined();
    expect(resumed.mentor?.threadId).toBe(threadId);
  });

  it("translates the held message and leaves translate mode behind on Switch", async () => {
    const { harness, generateChat, translatePrompts, telegramId, userId, promptCall } = await arrangeIdlePrompt();

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: promptCall.messageId ?? 0,
        data: MENTOR_IDLE_EXIT_CALLBACK,
      }),
    );

    // The mode moved in the DB, not just in the session.
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("translate");
    expect(sends(harness).some((call) => String(call.payload.text).includes(TRANSLATE_RETURNED_PREFIX))).toBe(true);

    // The hold was taken BEFORE `activateTranslateMode` cleared the slot: the
    // held text reached the translate pipeline and came back as a card.
    expect(translatePrompts.some((prompt) => prompt.includes(HELD_TEXT))).toBe(true);
    const { messageId: cardMsgId, buttons } = lastRenderedCard(harness.sent);
    expect(buttons).toContain(`tr:save:${cardMsgId}`);
    expect(generateChat).toHaveBeenCalledTimes(1);

    const session = await readSession(telegramId);
    expect(session.activeMode).toBe("translate");
    expect(session.mentor).toBeUndefined();
    expect(session.mentorIdlePrompt).toBeUndefined();
  });

  it("answers a Stay tap that has no held message with the stale alert instead of a paid turn", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ENTRY_AT);
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId, { plan: "plus" });
    const generateChat = vi.fn();
    const harness = createBotHarness({ ai: { ...deterministicTranslateAi(), generateChat } });

    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/mentor" }));

    // A button from a prompt this session never issued (an old chat message).
    vi.setSystemTime(IDLE_AT);
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: 987_654,
        data: MENTOR_IDLE_STAY_CALLBACK,
      }),
    );

    const alert = harness.sent.find((call) => call.method === "answerCallbackQuery");
    expect(alert?.payload.text).toBe(t("staleSession", "en"));
    expect(alert?.payload.show_alert).toBe(true);
    expect(generateChat).not.toHaveBeenCalled();
    expect((await userRepository.getSettings(userId))?.activeMode).toBe("mentor");

    // The stamp advanced (so the very next message is not re-prompted) and the
    // fresh-thread sentinel survived: no `threadId` was invented.
    const session = await readSession(telegramId);
    expect(session.mentor?.lastTurnAt).toBe(IDLE_AT.getTime());
    expect(session.mentor).not.toHaveProperty("threadId");
    expect(session.mentorIdlePrompt).toBeUndefined();
  });

  it("still switches to translate on a Switch tap that has no held message", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ENTRY_AT);
    const telegramId = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(telegramId, { plan: "plus" });
    const { ai, prompts: translatePrompts } = recordingTranslateAi();
    const generateChat = vi.fn();
    const harness = createBotHarness({ ai: { ...ai, generateChat } });

    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/mentor" }));

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: 987_655,
        data: MENTOR_IDLE_EXIT_CALLBACK,
      }),
    );

    expect((await userRepository.getSettings(userId))?.activeMode).toBe("translate");
    // Nothing to translate and nothing to answer: the switch is free.
    expect(generateChat).not.toHaveBeenCalled();
    expect(translatePrompts).toHaveLength(0);

    const session = await readSession(telegramId);
    expect(session.activeMode).toBe("translate");
    expect(session.mentor).toBeUndefined();
    expect(session.mentorIdlePrompt).toBeUndefined();
  });

  it("leaves a lost session lost on a stale Stay, so DB thread recovery still applies", async () => {
    const { harness, generateChat, telegramId, promptCall } = await arrangeIdlePrompt();

    // The session row is gone (restart-era loss / retention sweep): the hold and
    // the thread pin went with it, and only the mentor_messages rows remain.
    await botSessionRepository.delete(String(telegramId));

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: promptCall.messageId ?? 0,
        data: MENTOR_IDLE_STAY_CALLBACK,
      }),
    );

    const alert = harness.sent.find((call) => call.method === "answerCallbackQuery");
    expect(alert?.payload.text).toBe(t("staleSession", "en"));
    expect(generateChat).toHaveBeenCalledTimes(1);

    // Not materialised: `resolveThreadId` recovers the latest thread from the DB
    // only while `mentor` is undefined, so a stamp written here would silently
    // kill recovery for this chat.
    const session = await readSession(telegramId);
    expect(session.mentor).toBeUndefined();
    expect(session.mentorIdlePrompt).toBeUndefined();
  });
  it("holds a VOICE message behind the same prompt — a spoken turn is as ambiguous as a typed one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ENTRY_AT);

    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId, { plan: "pro" });

    const transcribe = vi
      .fn()
      .mockResolvedValue({ text: SPOKEN_TEXT, seconds: 2, costUsd: 0.0002, generationId: "gen-stt-idle" });
    const generateChat = vi.fn().mockResolvedValue(FIRST_ANSWER);
    const harness = createBotHarness({
      ai: { ...deterministicTranslateAi(), generateChat, transcribe },
      settings: {
        getSttConfig: vi
          .fn()
          .mockResolvedValue({ enabled: true, modelId: "openai/whisper-large-v3", maxDurationSec: 60 }),
      },
    });

    await harness.dispatch(messageUpdate({ chatId: telegramId, fromId: telegramId, text: "/mentor" }));
    vi.setSystemTime(TURN_AT);
    await harness.dispatch(
      messageUpdate({ chatId: telegramId, fromId: telegramId, text: FIRST_QUESTION, messageId: 11 }),
    );
    expect(generateChat).toHaveBeenCalledTimes(1);

    vi.setSystemTime(IDLE_AT);
    harness.reset();
    await harness.dispatch(voiceMessageUpdate({ chatId: telegramId, fromId: telegramId, duration: 4, messageId: 12 }));

    // Transcribed — there has to be text to hold — but no second paid turn ran.
    expect(transcribe).toHaveBeenCalledTimes(1);
    const promptCall = sends(harness).find((call) => call.payload.text === IDLE_QUESTION);
    expect(promptCall).toBeDefined();
    expect(callbackData(promptCall)).toEqual([MENTOR_IDLE_STAY_CALLBACK, MENTOR_IDLE_EXIT_CALLBACK]);
    expect(generateChat).toHaveBeenCalledTimes(1);

    // "Stay" resumes the TRANSCRIPT, not the typed question that preceded it.
    generateChat.mockResolvedValue(RESUMED_ANSWER);
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: telegramId,
        fromId: telegramId,
        messageId: promptCall?.messageId ?? 0,
        data: MENTOR_IDLE_STAY_CALLBACK,
      }),
    );

    const resumed = generateChat.mock.calls.at(-1)?.[0] as Array<{ role: string; content: string }>;
    expect(resumed.at(-1)).toEqual({ role: "user", content: SPOKEN_TEXT });
  });
});

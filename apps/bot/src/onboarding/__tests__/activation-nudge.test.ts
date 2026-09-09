/**
 * Task 72 slice 8 — D+1 activation nudge.
 *
 * Spec under test (the sweep and the callback; the *eligibility SQL* is proved
 * against a real Postgres in
 * `packages/adapters/db/src/__tests__/activation-nudge.repository.integration.test.ts`,
 * because "no translation since onboarding", "no nudge already recorded",
 * "≥ 24 h elapsed" and "onboarded_at IS NULL" are properties of the query, not
 * of this module):
 *
 * - An eligible user is nudged exactly once, and the delivery is recorded in
 *   `notification_history` under the shared source constant.
 * - A user already recorded under that source is not returned again — the second
 *   sweep sends nothing.
 * - The record is written only AFTER a successful send: a Telegram failure must
 *   leave the user eligible for the next sweep, and must not abort the batch.
 * - A user with no curated hook word for any learning language is skipped and
 *   not recorded.
 * - The nudge button renders the cached card without touching the AI port.
 */
import { ACTIVATION_NUDGE_SOURCE, type ActivationNudgeCandidate, type TranslateOutput } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServicesStub } from "../../test-helpers/services-stub.js";
import type { BotContext } from "../../types.js";
import { buildNudgeCardCallback, handleNudgeCardCallback } from "../activation-nudge.callbacks.js";
import { type ActivationNudgeServices, runActivationNudgeSweep } from "../activation-nudge.wiring.js";

/** German is the first curated language used below; `de[0]` is its first hook word. */
const DE_FIRST_HOOK = "Backpfeifengesicht";

const NOW = new Date("2026-08-02T09:40:00Z");

function candidate(overrides: Partial<ActivationNudgeCandidate> = {}): ActivationNudgeCandidate {
  return {
    userId: 1,
    telegramId: 1001,
    interfaceLang: "ru",
    nativeLang: "ru",
    learningLangs: ["de"],
    ...overrides,
  };
}

/**
 * Services stub backed by a tiny in-memory `notification_history`, so the
 * "never twice" property is exercised end-to-end through the same source
 * constant the production query filters on rather than being asserted by
 * restating the expectation.
 */
function createNudgeServices(pool: ActivationNudgeCandidate[]): {
  services: ActivationNudgeServices;
  history: Array<{ userId: number; original: string; source: string }>;
} {
  const history: Array<{ userId: number; original: string; source: string }> = [];
  const services = createServicesStub();

  vi.mocked(services.userRepository.findActivationNudgeCandidates).mockImplementation(async () =>
    pool.filter((user) => !history.some((row) => row.userId === user.userId && row.source === ACTIVATION_NUDGE_SOURCE)),
  );
  vi.mocked(services.notificationRepository.recordSentWord).mockImplementation(async (userId, original, source) => {
    history.push({ userId, original, source });
  });

  return { services, history };
}

describe("runActivationNudgeSweep", () => {
  it("nudges an eligible user once and records the delivery", async () => {
    const { services, history } = createNudgeServices([candidate()]);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });

    await runActivationNudgeSweep({ sendMessage }, services, NOW);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = sendMessage.mock.calls[0];
    expect(chatId).toBe(1001);
    expect(text).toContain(DE_FIRST_HOOK);
    // The button must carry the nudge-owned prefix, never `onb:` — every
    // recipient is already onboarded, and the onboarding handlers ignore those.
    expect(options.reply_markup.inline_keyboard[0][0].callback_data).toBe(buildNudgeCardCallback("de", 0));

    expect(history).toEqual([{ userId: 1, original: DE_FIRST_HOOK, source: ACTIVATION_NUDGE_SOURCE }]);
  });

  it("sends nothing on a second sweep once the delivery is recorded", async () => {
    const { services } = createNudgeServices([candidate()]);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });

    await runActivationNudgeSweep({ sendMessage }, services, NOW);
    await runActivationNudgeSweep({ sendMessage }, services, NOW);

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not record a delivery when the Telegram send fails, and keeps going", async () => {
    const { services, history } = createNudgeServices([
      candidate({ userId: 1, telegramId: 1001 }),
      candidate({ userId: 2, telegramId: 1002 }),
    ]);
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Forbidden: bot was blocked by the user"))
      .mockResolvedValue({ message_id: 1 });

    await runActivationNudgeSweep({ sendMessage }, services, NOW);

    // The failure did not abort the batch — the second user was still nudged.
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(history).toEqual([{ userId: 2, original: DE_FIRST_HOOK, source: ACTIVATION_NUDGE_SOURCE }]);

    // …and the failed user is still eligible on the next sweep.
    await runActivationNudgeSweep({ sendMessage }, services, NOW);
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage.mock.calls[2][0]).toBe(1001);
  });

  it("skips a user with no curated hook word for any learning language", async () => {
    const { services, history } = createNudgeServices([candidate({ learningLangs: ["zz"] })]);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });

    await runActivationNudgeSweep({ sendMessage }, services, NOW);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(history).toEqual([]);
  });
});

const cachedOutput: TranslateOutput = {
  original: DE_FIRST_HOOK,
  sourceLang: "de",
  emoji: "😠",
  nativeSynonyms: [],
  translations: {
    ru: { text: "лицо, которое хочется ударить", synonyms: [], examples: [] },
  },
};

function createCallbackContext(data: string) {
  const services = createServicesStub();
  vi.mocked(services.userRepository.getSettings).mockResolvedValue({
    id: 1,
    userId: 1,
    interfaceLang: "ru",
    nativeLang: "ru",
    learningLangs: ["de"],
    timezone: "UTC",
    activeMode: "translate",
    lastSourceLang: null,
    notificationEnabled: false,
    notificationTimes: [],
    notificationType: "srs",
    notificationContext: null,
    lastInteractionAt: null,
    isActive: true,
    updatedAt: new Date(),
  });
  vi.mocked(services.onboardingDemoCardRepository.findOne).mockResolvedValue({
    id: 7,
    sourceLang: "de",
    nativeLang: "ru",
    headword: DE_FIRST_HOOK,
    payload: cachedOutput,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date(),
  });

  const reply = vi.fn().mockResolvedValue({ message_id: 42 });
  const answerCallbackQuery = vi.fn().mockResolvedValue(true);
  const editMessageReplyMarkup = vi.fn().mockResolvedValue(true);

  const ctx = {
    callbackQuery: { data },
    chat: { id: 555 },
    from: { id: 555, language_code: "ru" },
    user: { id: 1 },
    session: {},
    services,
    reply,
    answerCallbackQuery,
    api: { editMessageReplyMarkup },
  } as unknown as BotContext;

  return { ctx, services, reply, answerCallbackQuery };
}

describe("handleNudgeCardCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the cached card without touching the AI port", async () => {
    const { ctx, services, reply, answerCallbackQuery } = createCallbackContext(buildNudgeCardCallback("de", 0));

    await handleNudgeCardCallback(ctx);

    expect(answerCallbackQuery).toHaveBeenCalled();
    // The headword/native pair is resolved from the callback data alone.
    expect(services.onboardingDemoCardRepository.findOne).toHaveBeenCalledWith("de", "ru", DE_FIRST_HOOK);
    // …and the card the user sees is the cached payload, rendered as a real card.
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][0]).toContain("лицо, которое хочется ударить");
    expect(services.ai.generateObject).not.toHaveBeenCalled();
    expect(services.ai.generateText).not.toHaveBeenCalled();
  });
});

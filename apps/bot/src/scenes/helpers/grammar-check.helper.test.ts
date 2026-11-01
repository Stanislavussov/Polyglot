import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserRepository, mockAi, mockSettings, mockTranslationRequestRepository } = vi.hoisted(() => ({
  mockUserRepository: {
    getSettings: vi.fn(),
    getLanguageLevels: vi.fn(),
    updateActiveMode: vi.fn(),
  },
  mockAi: { generateObject: vi.fn() },
  mockSettings: {
    getDefaultAIModel: vi.fn(),
    getDefaultAIModelForPlan: vi.fn(),
    getFallbackAIModel: vi.fn(),
    getMentorConfig: vi.fn(),
    getPlanLimit: vi.fn(),
  },
  mockTranslationRequestRepository: {
    getUserCreditsInWindow: vi.fn(),
    countRequestsInWindow: vi.fn(),
    logTranslationRequest: vi.fn(),
  },
}));

vi.mock("../../metrics.js", () => ({
  grammarCheckCounter: { inc: vi.fn() },
  grammarCheckDuration: { startTimer: vi.fn().mockReturnValue(() => undefined) },
}));

import { AITimeoutError, type GrammarCheckOutcome, t } from "@polyglot/core";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { BotContext, SessionData } from "../../types.js";
import { RETRY_CALLBACK, takeRetryAction } from "../../utils/retry-action.js";
import { GRAMMAR_EXIT_CALLBACK, handleGrammarCheckText, renderGrammarCheck } from "./grammar-check.helper.js";

type Checked = Extract<GrammarCheckOutcome, { status: "checked" }>;

const issue = {
  fragment: "habe gefahren",
  correction: "bin gefahren",
  category: "tense" as const,
  explanation: "Movement verbs take <sein>.",
  example: "Ich bin gegangen.",
};

function planLimit(grammarCheckDailyLimit: number | null) {
  return {
    name: "free",
    label: "Free",
    translationLimit: null,
    creditCost: 1,
    videoLimit: 0,
    videoWindow: "none",
    mentorDailyLimit: 0,
    grammarCheckDailyLimit,
    dailyCreditCeiling: null,
    priceUsdCents: null,
    isActive: true,
    isDefault: true,
  };
}

function createMockCtx(audienceGroup = "product"): BotContext {
  return {
    from: { id: 42 },
    chat: { id: 42 },
    update: { update_id: 1 },
    message: { message_id: 5, text: "x" },
    session: { activeMode: "grammar" } as SessionData,
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
    user: { id: 1, telegramId: 42, onboarded: true, audienceGroup, subscriptionPlan: "free" },
    services: {
      productEventRepository: { record: vi.fn().mockResolvedValue(undefined) },
      userRepository: mockUserRepository,
      ai: mockAi,
      settings: mockSettings,
      translationRequestRepository: mockTranslationRequestRepository,
      languageCache: { getLangDisplay: (code: string) => `[${code}]` },
    },
    api: { deleteMessage: vi.fn().mockResolvedValue(undefined), editMessageText: vi.fn() },
  } as unknown as BotContext;
}

/** Every reply after the loader, as [text, options]. */
function answers(ctx: BotContext): Array<[string, Record<string, unknown> | undefined]> {
  return vi.mocked(ctx.reply).mock.calls.map(([text, options]) => [String(text), options as Record<string, unknown>]);
}

function exitButtonOf(options: Record<string, unknown> | undefined): string | undefined {
  const button = (options?.reply_markup as InlineKeyboardMarkup | undefined)?.inline_keyboard.flat()[0];
  return button && "callback_data" in button ? button.callback_data : undefined;
}

describe("renderGrammarCheck", () => {
  const checked: Checked = {
    status: "checked",
    language: "de",
    errors: [issue],
    correctedText: "Ich bin <gestern> gefahren.",
    naturalAlternative: null,
  };

  it("shows each mistake with its correction, category, rule and example, then the corrected text", () => {
    const html = renderGrammarCheck(checked, "en");

    expect(html).toContain("1. <s>habe gefahren</s> → <b>bin gefahren</b>");
    expect(html).toContain(t("grammarCategoryTense", "en"));
    expect(html).toContain(`${t("grammarCheckWhyLabel", "en")} Movement verbs take &lt;sein&gt;.`);
    expect(html).toContain(`${t("grammarCheckExampleLabel", "en")} <i>Ich bin gegangen.</i>`);
    expect(html.indexOf(t("grammarCheckCorrected", "en"))).toBeGreaterThan(html.indexOf("Ich bin gegangen."));
    // Model-written text is escaped, so it can never break the HTML send.
    expect(html).toContain("Ich bin &lt;gestern&gt; gefahren.");
  });

  it("says a correct text is correct, with a more natural phrasing when the model offered one", () => {
    const plain = renderGrammarCheck({ ...checked, errors: [], naturalAlternative: null }, "en");
    const withAlternative = renderGrammarCheck({ ...checked, errors: [], naturalAlternative: "Gestern & heute" }, "en");

    expect(plain).toBe(t("grammarCheckCorrect", "en"));
    expect(withAlternative).toContain(t("grammarCheckNaturalAlternative", "en"));
    expect(withAlternative).toContain("<i>Gestern &amp; heute</i>");
  });

  it("drops whole issues rather than overflow one Telegram message, and says how many were left out", () => {
    const long = { ...issue, explanation: "x".repeat(900) };
    const html = renderGrammarCheck({ ...checked, errors: Array.from({ length: 8 }, () => long) }, "en");

    expect(html.length).toBeLessThan(4096);
    expect(html).toContain(t("grammarCheckMoreIssues", "en", { count: 5 }));
    expect(html).toContain(t("grammarCheckCorrected", "en"));
  });
});

describe("handleGrammarCheckText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRepository.getSettings.mockResolvedValue({ interfaceLang: "en", nativeLang: "ru", learningLangs: ["de"] });
    mockUserRepository.getLanguageLevels.mockResolvedValue([{ languageCode: "de", proficiencyLevel: "A2" }]);
    mockSettings.getDefaultAIModelForPlan.mockResolvedValue("model/default");
    mockSettings.getDefaultAIModel.mockResolvedValue("model/default");
    mockSettings.getFallbackAIModel.mockResolvedValue(null);
    mockSettings.getMentorConfig.mockResolvedValue({ modelId: "model/mentor", maxTokens: 700 });
    mockSettings.getPlanLimit.mockResolvedValue(planLimit(5));
    mockTranslationRequestRepository.getUserCreditsInWindow.mockResolvedValue(0);
    mockTranslationRequestRepository.countRequestsInWindow.mockResolvedValue(0);
    mockTranslationRequestRepository.logTranslationRequest.mockResolvedValue(1);
    mockAi.generateObject.mockResolvedValue({
      detectedLanguage: "de",
      errors: [issue],
      correctedText: "Ich bin gefahren.",
      naturalAlternative: null,
    });
  });

  it("answers with the rendered check and the exit button, and bills one grammar check", async () => {
    const ctx = createMockCtx();

    await handleGrammarCheckText(ctx, "Ich habe gefahren.");

    const [text, options] = answers(ctx).at(-1) ?? [];
    expect(text).toContain("<s>habe gefahren</s>");
    expect(options?.parse_mode).toBe("HTML");
    expect(exitButtonOf(options)).toBe(GRAMMAR_EXIT_CALLBACK);
    expect(mockAi.generateObject.mock.calls[0][2]).toBe("model/mentor");
    expect(mockTranslationRequestRepository.logTranslationRequest).toHaveBeenCalledWith(
      1,
      "[grammarCheck]",
      "de",
      [],
      2,
    );
  });

  it("refuses a text past the length cap before spending anything", async () => {
    const ctx = createMockCtx();

    await handleGrammarCheckText(ctx, "a".repeat(1001));

    expect(mockAi.generateObject).not.toHaveBeenCalled();
    expect(answers(ctx)[0]?.[0]).toBe(t("mentorInputTooLong", "en", { max: 1000 }));
  });

  it("refuses the sixth check of the day on a five-a-day plan, with the upgrade offer", async () => {
    mockTranslationRequestRepository.countRequestsInWindow.mockResolvedValue(5);
    const ctx = createMockCtx();

    await handleGrammarCheckText(ctx, "Ich habe gefahren.");

    expect(mockAi.generateObject).not.toHaveBeenCalled();
    const [text, options] = answers(ctx)[0] ?? [];
    expect(text).toBe(t("grammarCheckDailyLimitReached", "en", { limit: "5" }));
    expect(JSON.stringify(options?.reply_markup)).toContain("plan:upgrade");
    expect(mockTranslationRequestRepository.countRequestsInWindow).toHaveBeenCalledWith(
      1,
      "[grammarCheck]",
      expect.any(Date),
    );
  });

  it("treats a limit of 0 as a plan without the check", async () => {
    mockSettings.getPlanLimit.mockResolvedValue(planLimit(0));
    const ctx = createMockCtx();

    await handleGrammarCheckText(ctx, "Ich habe gefahren.");

    expect(mockAi.generateObject).not.toHaveBeenCalled();
    expect(answers(ctx)[0]?.[0]).toBe(t("grammarCheckNotInPlan", "en"));
  });

  it("never caps an unlimited plan or an internal account", async () => {
    mockSettings.getPlanLimit.mockResolvedValue(planLimit(null));
    mockTranslationRequestRepository.countRequestsInWindow.mockResolvedValue(10_000);
    await handleGrammarCheckText(createMockCtx(), "Ich habe gefahren.");

    mockSettings.getPlanLimit.mockResolvedValue(planLimit(0));
    await handleGrammarCheckText(createMockCtx("admin"), "Ich habe gefahren.");

    expect(mockAi.generateObject).toHaveBeenCalledTimes(2);
  });

  it("lists the checkable languages when the text is in another one", async () => {
    mockAi.generateObject.mockResolvedValue({
      detectedLanguage: "fr",
      errors: [],
      correctedText: "",
      naturalAlternative: null,
    });
    const ctx = createMockCtx();

    await handleGrammarCheckText(ctx, "Je suis allé.");

    const [text, options] = answers(ctx).at(-1) ?? [];
    expect(text).toBe(t("grammarCheckUnsupportedLanguage", "en", { languages: "[ru], [de]" }));
    expect(exitButtonOf(options)).toBe(GRAMMAR_EXIT_CALLBACK);
  });

  it("offers a one-tap retry of the same text when the check times out, without billing it", async () => {
    mockAi.generateObject.mockRejectedValue(new AITimeoutError(1000));
    const ctx = createMockCtx();

    await handleGrammarCheckText(ctx, "Ich habe gefahren.");

    const [text, options] = answers(ctx).at(-1) ?? [];
    expect(text).toBe(t("loadingTimeout", "en"));
    expect(JSON.stringify(options?.reply_markup)).toContain(RETRY_CALLBACK);
    expect(takeRetryAction(ctx.session, 100)).toMatchObject({ kind: "grammar", text: "Ich habe gefahren." });
    expect(mockTranslationRequestRepository.logTranslationRequest).not.toHaveBeenCalled();
  });
});

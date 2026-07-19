/**
 * Phase-level timing metrics for the translate path (latency Phase 0).
 *
 * Spec:
 *  - A happy-path translate observes each phase EXACTLY ONCE. The bot measures
 *    `pre_ai`, `detection` and `post_ai` directly; `generate`, `validate` and
 *    `judge` happen inside the pure-core pipeline and reach the histogram only
 *    through the `onPhase` sink the bot hands to `translateWithContext`.
 *  - The bot must NOT also time `generate` itself — core already reports it, and
 *    timing it on both sides would double-count the phase.
 *  - The emitted label set stays bounded — every emitted `phase` value must come
 *    from the declared `TRANSLATION_PHASES` set, and nothing outside it is ever
 *    emitted (no per-user/word/model dimension).
 *  - The bot never fabricates a core phase: a core that reports nothing yields no
 *    `generate`/`validate`/`judge` series at all.
 *  - The bot supplies a `budgetMs`, without which the whole Phase 2.5 tail bound
 *    (judge time box + adaptive repair) would be inert in production.
 *  - The mistype-confirm entry point re-enters the shared pipeline; it must not
 *    double-observe the phases the main flow already recorded.
 *
 * Deliberately NOT asserted: any duration VALUE. Timing is nondeterministic;
 * only observation counts and label names are behaviour.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

const {
  corePhasesToReport,
  mockLookupContext,
  mockUserRepository,
  mockVocabularyRepository,
  mockTranslationTemplateRepository,
  mockTranslationRequestRepository,
  mockLanguageCache,
  mockAi,
  mockLogger,
} = vi.hoisted(() => ({
  /**
   * Phases the stubbed core pipeline reports back through `onPhase`. Mutable so a
   * test can simulate a core that reports nothing (older core, or a step that
   * never ran) and assert the bot invents no value of its own.
   */
  corePhasesToReport: { value: ["generate", "validate", "judge"] as string[] },
  mockLookupContext: vi.fn().mockResolvedValue([]),
  mockUserRepository: {
    getSettings: vi.fn(),
  },
  mockVocabularyRepository: {
    create: vi.fn().mockResolvedValue({ id: 1, translations: [] }),
    findByOriginalAndSource: vi.fn().mockResolvedValue(null),
    updateTranslation: vi.fn().mockResolvedValue({}),
  },
  mockTranslationTemplateRepository: {
    getByUserId: vi.fn().mockResolvedValue(null),
  },
  mockTranslationRequestRepository: {
    getUserCreditsInWindow: vi.fn().mockResolvedValue(0),
    logTranslationRequest: vi.fn().mockResolvedValue(1),
  },
  mockLanguageCache: {
    getLang: vi.fn().mockReturnValue({ id: 1, code: "en", name: "English" }),
    getLangDisplay: (code: string) => code,
  },
  mockAi: {
    generateObject: vi.fn(),
  },
  mockLogger: {
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  actual.initLanguageRegistry([
    { code: "en", name: "English", nativeName: "English", flag: "🇬🇧", isSupported: true },
    { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", isSupported: true },
    { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿", isSupported: true },
  ]);
  return {
    ...actual,
    // Stands in for the pure-core pipeline: reports its internal phase timings
    // through the `onPhase` sink the bot passes in, exactly as the real
    // `translateWithContext` does, then returns an accepted decision.
    translateWithContext: vi.fn(async (_input: unknown, deps: { onPhase?: (p: string, ms: number) => void }) => {
      for (const phase of corePhasesToReport.value) {
        deps.onPhase?.(phase, 5);
      }
      return {
        status: "accepted",
        output: {
          original: "hello",
          sourceLang: "en",
          emoji: "👋",
          nativeSynonyms: [],
          translations: {
            ru: { text: "привет", synonyms: [], examples: [] },
            cs: { text: "ahoj", synonyms: [], examples: [] },
          },
        },
        quality: {
          promptVersion: "translation-v1",
          schemaVersion: 1,
          riskLevel: "low",
          modelId: "test-model",
          attemptCount: 1,
          issues: [],
        },
      };
    }),
    detectLanguageWithConfidence: vi.fn(() => ({
      language: "en",
      confidence: 0.9,
      evidence: [{ strategy: "script", candidate: "en", score: 0.9, reason: "mock" }],
    })),
    detectLanguageWithConfidenceAsync: vi.fn(async () => ({ confidence: 0, evidence: [] })),
    logger: mockLogger,
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: mockLogger,
}));

import { translateWithContext } from "@polyglot/core";
import { TRANSLATION_PHASES, translationPhaseDuration } from "../../../metrics.js";
import type { BotContext, SessionData } from "../../../types.js";
import { LONG_OP_TIMEOUT_MS, TRANSLATION_BUDGET_MS } from "../../../utils/long-op.js";
import { handleMistypeConfirmCallback, handleTranslateText } from "../translate-flow.js";

/**
 * Observation count per `phase` label, read from the live registry. A histogram
 * emits one `_count` series per label combination, so this is the number of
 * times each phase was observed — never a duration.
 */
async function phaseObservationCounts(): Promise<Record<string, number>> {
  const metric = await translationPhaseDuration.get();
  const counts: Record<string, number> = {};
  for (const entry of metric.values) {
    if (!entry.metricName?.endsWith("_count")) continue;
    const phase = entry.labels.phase;
    if (typeof phase !== "string") continue;
    counts[phase] = (counts[phase] ?? 0) + entry.value;
  }
  return counts;
}

function createMockCtx(): BotContext {
  const session: SessionData = {
    activeMode: "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
    lastTranslation: undefined,
    lastInputType: undefined,
    savedWordId: undefined,
    needsTranslateReminder: false,
    pendingDetectedLang: undefined,
    pendingWord: undefined,
    pendingDirection: undefined,
  };

  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
    },
    user: { id: 1, telegramId: 123456789 },
    services: {
      userRepository: mockUserRepository,
      vocabularyRepository: mockVocabularyRepository,
      vocabularyDictionaryRepository: {
        entryBelongsToDefault: vi.fn().mockResolvedValue(false),
      },
      translationTemplateRepository: mockTranslationTemplateRepository,
      translationRequestRepository: mockTranslationRequestRepository,
      languageDetectionRepository: { record: vi.fn().mockResolvedValue(undefined) },
      requestTimingRepository: { record: vi.fn().mockResolvedValue(undefined) },
      contextLookup: mockLookupContext,
      wordLanguageSweep: vi.fn().mockResolvedValue([]),
      settings: {
        getPlanLimit: () =>
          Promise.resolve({
            name: "free",
            label: "Free",
            translationLimit: 50,
            creditCost: 1,
            isActive: true,
            isDefault: true,
          }),
      },
      languageCache: mockLanguageCache,
      ai: mockAi,
    },
  } as unknown as BotContext;
}

/** Measured bot-side directly. */
const BOT_MEASURED_PHASES = ["pre_ai", "detection", "post_ai"] as const;
/** Measured inside pure core and delivered through the `onPhase` sink. */
const CORE_REPORTED_PHASES = ["generate", "validate", "judge"] as const;

describe("translate phase timing metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    translationPhaseDuration.reset();
    corePhasesToReport.value = ["generate", "validate", "judge"];
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
    mockTranslationRequestRepository.getUserCreditsInWindow.mockResolvedValue(0);
  });

  it("observes every phase exactly once on a happy-path translate", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    const counts = await phaseObservationCounts();
    for (const phase of [...BOT_MEASURED_PHASES, ...CORE_REPORTED_PHASES]) {
      expect(counts[phase], `phase "${phase}" observation count`).toBe(1);
    }
  });

  it("does not also time `generate` bot-side, which would double-count it", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    // Core reported `generate` exactly once. If the bot still wrapped its own
    // timer around the core call, this would be 2.
    expect((await phaseObservationCounts()).generate).toBe(1);
  });

  it("passes a bounded absolute deadline, without which the Phase 2.5 tail bound is inert", async () => {
    const before = Date.now();
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");
    const after = Date.now();

    const [input] = vi.mocked(translateWithContext).mock.calls[0];
    // Pin the DEADLINE ITSELF, not merely that some budget-ish property was set.
    // Core reads `deadlineAt`; anything else (a renamed or stale field) rides
    // through as an ignored extra property and silently leaves the pipeline
    // UNBOUNDED — and because vitest does not typecheck, that would otherwise
    // ship with a fully green suite.
    expect(input.deadlineAt).toBeGreaterThanOrEqual(before + TRANSLATION_BUDGET_MS);
    expect(input.deadlineAt).toBeLessThanOrEqual(after + TRANSLATION_BUDGET_MS);
    // The pipeline must finish inside the outer op guard, or it would be killed
    // with a user-facing error before it could degrade gracefully.
    expect(TRANSLATION_BUDGET_MS).toBeLessThan(LONG_OP_TIMEOUT_MS);
  });

  it("emits only labels from the declared bounded phase set", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    const emitted = Object.keys(await phaseObservationCounts());
    expect(emitted.length).toBeGreaterThan(0);
    for (const phase of emitted) {
      expect(TRANSLATION_PHASES).toContain(phase);
    }
  });

  it("does not fabricate a core phase the pipeline never reported", async () => {
    // A core that reports nothing (e.g. the judge step never ran) must leave
    // those series absent — an estimated value would be worse than a missing one.
    corePhasesToReport.value = [];
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    const counts = await phaseObservationCounts();
    for (const phase of CORE_REPORTED_PHASES) {
      expect(counts[phase], `phase "${phase}" must not be fabricated`).toBeUndefined();
    }
    // The bot's own phases are unaffected.
    expect(counts.pre_ai).toBe(1);
  });

  it("carries no unbounded dimension beyond `phase`", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    const metric = await translationPhaseDuration.get();
    for (const entry of metric.values) {
      const extra = Object.keys(entry.labels).filter((key) => key !== "phase" && key !== "le");
      expect(extra).toEqual([]);
    }
  });

  it("does not double-observe pre-pipeline phases when the mistype flow re-enters the pipeline", async () => {
    const ctx = createMockCtx();
    ctx.session.pendingWord = "helo";
    ctx.session.pendingDirection = { sourceLang: "en", targetLangs: ["ru"] };

    await handleMistypeConfirmCallback(ctx);

    const counts = await phaseObservationCounts();
    // The mistype callback is its own update: it re-runs the shared pipeline
    // (generate + post_ai) but must not re-emit the main flow's phases.
    expect(counts.detection).toBeUndefined();
    expect(counts.generate).toBe(1);
    expect(counts.post_ai).toBe(1);
  });
});

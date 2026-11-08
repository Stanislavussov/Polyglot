/**
 * Spec — runTranslation, the one translation process for every channel.
 *
 * 1. Input is validated before anything costs money: an empty, emoji-only, command,
 *    digits-only or over-long text is `rejected` with its reason; a context marker
 *    with no text before it is `rejected` as `needs_text`. No quota read, no AI call.
 * 2. A user with no learning language gets `no_languages`.
 * 3. The language is resolved before the quota gate:
 *    - input in a language the user does not study → `add_language` (supported flag);
 *    - a word found in two of the user's dictionaries → `needs_language` (ambiguous);
 *    so an exhausted quota never hides these questions.
 * 4. An answer is stateless and re-checked: `answer.sourceLang` outside the user's
 *    languages (plus English) is `rejected` as `invalid_language`; a valid one skips
 *    detection and the typo/existence questions.
 * 5. An exhausted quota is `limit`, and the AI pipeline is not called.
 * 6. The pipeline's question is `needs_clarification` with a channel-neutral view,
 *    unless its correction is in an unstudied language's alphabet → `add_language`.
 * 7. An AI timeout is `timeout`; a result is `done`, logged once in the ledger, and
 *    `needs_review` results carry `needsReview: true`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserLanguageSettings } from "../../../ports/user.repository.js";
import { AITimeoutError } from "../../../shared/errors.js";
import { translateWithContext } from "../../context-enrichment/context-enrichment.service.js";
import { checkTranslationQuota } from "../../entitlements/quota.js";
import type { TranslateOutput, TranslationDecision } from "../../translation/types.js";
import { type RunTranslationDeps, runTranslation } from "../run-translation.js";

vi.mock("../../context-enrichment/context-enrichment.service.js", () => ({ translateWithContext: vi.fn() }));
vi.mock("../../entitlements/quota.js", () => ({ checkTranslationQuota: vi.fn() }));

const user = { id: 7, audienceGroup: "product" as const, subscriptionPlan: "free" as const };

function output(original: string, sourceLang = "en"): TranslateOutput {
  return { original, sourceLang, translations: { cs: { text: "ahoj" } } } as unknown as TranslateOutput;
}

function makeDeps(learningLangs: string[] = ["cs"], overrides: Partial<RunTranslationDeps> = {}) {
  const logTranslationRequest = vi.fn().mockResolvedValue(99);
  const generateText = vi.fn().mockResolvedValue("??");
  const deps: RunTranslationDeps = {
    settings: {
      getDefaultAIModelForPlan: vi.fn().mockResolvedValue("model-a"),
      getFallbackAIModel: vi.fn().mockResolvedValue(null),
    } as unknown as RunTranslationDeps["settings"],
    users: {
      getSettings: vi
        .fn()
        .mockResolvedValue({ interfaceLang: "en", nativeLang: "en", learningLangs } as UserLanguageSettings),
    },
    translationRequests: {
      logTranslationRequest,
      getUserCreditsInWindow: vi.fn().mockResolvedValue(0),
      countRequestsInWindow: vi.fn().mockResolvedValue(0),
    },
    templates: { getByUserId: vi.fn().mockResolvedValue(null) },
    ai: { generateObject: vi.fn(), generateText },
    contextLookup: vi.fn().mockResolvedValue([]),
    logEvent: vi.fn(),
    ...overrides,
  };
  return { deps, logTranslationRequest, generateText };
}

const accepted = (out: TranslateOutput): TranslationDecision =>
  ({ status: "accepted", output: out, quality: { modelId: "model-a" } }) as unknown as TranslationDecision;

beforeEach(() => {
  vi.mocked(translateWithContext).mockReset();
  vi.mocked(checkTranslationQuota).mockReset().mockResolvedValue({ ok: true, creditCost: 1 });
});

describe("runTranslation", () => {
  it.each([
    ["😀", "emoji"],
    ["/start", "command"],
    ["12 + 3", "digits"],
    ["a".repeat(501), "tooLong"],
    ["   ", "empty"],
    [" :: food", "needs_text"],
  ])("rejects %j as %s before the quota or the AI", async (text, reason) => {
    const { deps } = makeDeps();
    const outcome = await runTranslation({ user, text, channel: "web" }, deps);
    expect(outcome).toEqual({ status: "rejected", reason, maxLength: 500 });
    expect(checkTranslationQuota).not.toHaveBeenCalled();
    expect(translateWithContext).not.toHaveBeenCalled();
  });

  it("answers no_languages when the user studies nothing", async () => {
    const { deps } = makeDeps([]);
    expect(await runTranslation({ user, text: "hello", channel: "web" }, deps)).toEqual({ status: "no_languages" });
  });

  it("offers to add a language the input is written in, before the quota gate", async () => {
    const { deps } = makeDeps();
    vi.mocked(checkTranslationQuota).mockResolvedValue({ ok: false, reason: "plan", resetAt: new Date() });
    const outcome = await runTranslation({ user, text: "mañana", channel: "web" }, deps);
    expect(outcome).toMatchObject({ status: "add_language", lang: "es", supported: true, text: "mañana" });
    expect(checkTranslationQuota).not.toHaveBeenCalled();
  });

  it("asks which language a word found in two of the user's dictionaries is in", async () => {
    const { deps } = makeDeps(["cs"], { wordLanguageSweep: vi.fn().mockResolvedValue(["en", "cs"]) });
    const outcome = await runTranslation({ user, text: "hotel", channel: "web" }, deps);
    expect(outcome).toMatchObject({ status: "needs_language", kind: "ambiguous", text: "hotel" });
    expect(outcome.status === "needs_language" && [...outcome.candidates].sort()).toEqual(["cs", "en"]);
    expect(translateWithContext).not.toHaveBeenCalled();
  });

  it("rejects an answered language the user does not have", async () => {
    const { deps } = makeDeps();
    const outcome = await runTranslation({ user, text: "hotel", channel: "web", answer: { sourceLang: "de" } }, deps);
    expect(outcome).toMatchObject({ status: "rejected", reason: "invalid_language" });
  });

  it("translates from the answered language without asking about the input again", async () => {
    const { deps, logTranslationRequest } = makeDeps();
    vi.mocked(translateWithContext).mockResolvedValue(accepted(output("hotel", "cs")));
    const outcome = await runTranslation({ user, text: "hotel", channel: "web", answer: { sourceLang: "cs" } }, deps);
    expect(outcome).toMatchObject({ status: "done", sourceLang: "cs", targetLangs: ["en"], needsReview: false });
    const input = vi.mocked(translateWithContext).mock.calls[0]![0];
    expect(input.correctionPolicy).toEqual({ assessSourceExistence: true, skipInputCorrection: true });
    expect(input.detectionConfidence).toBeUndefined();
    expect(logTranslationRequest).toHaveBeenCalledWith(7, "hotel", "cs", ["en"], 1);
  });

  it("stops at the quota without calling the AI", async () => {
    const { deps } = makeDeps();
    const resetAt = new Date("2026-12-01T00:00:00Z");
    vi.mocked(checkTranslationQuota).mockResolvedValue({ ok: false, reason: "plan", resetAt });
    const outcome = await runTranslation({ user, text: "hello", channel: "web", answer: { sourceLang: "en" } }, deps);
    expect(outcome).toEqual({ status: "limit", reason: "plan", resetAt });
    expect(translateWithContext).not.toHaveBeenCalled();
  });

  it("returns the pipeline's question as a channel-neutral view", async () => {
    const { deps } = makeDeps();
    vi.mocked(translateWithContext).mockResolvedValue({
      status: "needs_clarification",
      ambiguity: {
        reason: "word_sense",
        options: [{ id: "a", label: "bank (river)", value: "river", kind: "meaning" }],
      },
    } as TranslationDecision);
    const outcome = await runTranslation({ user, text: "bank", channel: "web", answer: { sourceLang: "en" } }, deps);
    expect(outcome).toMatchObject({
      status: "needs_clarification",
      sourceLang: "en",
      view: { options: [{ kind: "meaning", label: "bank (river)", value: "river" }] },
    });
  });

  it("turns a correction in an unstudied alphabet into an add-language offer", async () => {
    const { deps } = makeDeps(["ru"]);
    vi.mocked(translateWithContext).mockResolvedValue({
      status: "needs_clarification",
      ambiguity: {
        reason: "unrecognized_word",
        options: [
          { id: "fix", label: "қыздар-ай", value: "қыздар-ай", kind: "typo_correction", correctedText: "қыздар-ай" },
        ],
      },
    } as TranslationDecision);
    const outcome = await runTranslation(
      { user, text: "кыздарай", channel: "web", answer: { sourceLang: "ru" } },
      deps,
    );
    expect(outcome).toMatchObject({ status: "add_language", lang: "kk", supported: true });
  });

  it("reports an AI timeout as timeout", async () => {
    const { deps, logTranslationRequest } = makeDeps();
    vi.mocked(translateWithContext).mockRejectedValue(new AITimeoutError(1000));
    const outcome = await runTranslation({ user, text: "hello", channel: "web", answer: { sourceLang: "en" } }, deps);
    expect(outcome).toEqual({ status: "timeout" });
    expect(logTranslationRequest).not.toHaveBeenCalled();
  });

  it("marks a needs_review result", async () => {
    const { deps } = makeDeps();
    vi.mocked(translateWithContext).mockResolvedValue({
      status: "needs_review",
      output: output("hello"),
      issues: [],
    } as unknown as TranslationDecision);
    const outcome = await runTranslation({ user, text: "hello", channel: "web", answer: { sourceLang: "en" } }, deps);
    expect(outcome).toMatchObject({ status: "done", needsReview: true });
  });
});

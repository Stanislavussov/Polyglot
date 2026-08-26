import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../logger.js";
import { setLogger } from "../../../logger.js";
import { MINIMAL_OUTPUT, SENTENCE_OUTPUT } from "../../../shared/translation-output.presets.js";
import {
  buildJudgePrompt,
  parseResponse,
  sanitizeEmoji,
  translate,
  translateBatch,
  translateOne,
} from "../translation.service.js";
import type {
  TranslateInput,
  TranslateOutput,
  TranslationDecision,
  TranslationRequest,
  TranslationResult,
} from "../types.js";

function unwrap(d: TranslationDecision): TranslateOutput {
  if (!("output" in d)) throw new Error(`Unexpected needs_clarification: ${d.ambiguity.message}`);
  return d.output;
}

/** Shared mock logger for validation logging tests */
const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/** A valid AI response matching translationResultSchema */
function makeValidResult(overrides?: Partial<TranslationResult>): TranslationResult {
  const base: TranslationResult = {
    emoji: "👋",
    nativeMeaning: "A greeting.",
    nativeSynonyms: [{ text: "привет" }],
    translations: {
      cs: {
        text: "ahoj",
        synonyms: [{ text: "čau" }],
        examples: [
          { context: "neutral", target: "Řekl ahoj svému kolegovi." },
          { context: "colloquial", target: "Ahoj, jak se máš?" },
          { context: "professional", target: "Ahoj, vítejte na schůzce." },
        ],
        expressionType: null,
        equivalentNote: null,
        alternatives: null,
        connotationWarning: null,
      },
    },
  };

  if (!overrides) {
    return base;
  }

  return {
    ...base,
    ...overrides,
    translations:
      overrides.translations === undefined
        ? base.translations
        : Object.keys(overrides.translations).length === 0
          ? {}
          : {
              ...base.translations,
              ...Object.fromEntries(
                Object.entries(overrides.translations).map(([lang, translation]) => [
                  lang,
                  {
                    ...base.translations.cs,
                    ...translation,
                  },
                ]),
              ),
            },
  };
}

const PREFLIGHT_PROCEED = {
  confidence: 0.95,
  outcome: "proceed",
  reasonCode: "low_confidence",
  explanation: "No clarification needed.",
  options: [],
};

/** Split a TranslationResult into metadata and per-language blocks for parallel mock setup */
function splitForMock(result: TranslationResult) {
  const { translations, ...metadata } = result;
  return {
    metadata: { ...metadata, nativeSynonyms: metadata.nativeSynonyms ?? [] },
    langBlocks: translations,
  };
}

/**
 * Create a mock generateObjectFn that auto-detects parallel call type from prompt content.
 * Returns metadata for metadata calls, language blocks for language calls,
 * and optionally a judge result for judge calls.
 */
function createTranslateMock(
  result: TranslationResult,
  judgeResult?: { issues: { fieldPath: string; message: string }[]; summary: string },
) {
  const { metadata, langBlocks } = splitForMock(result);
  return vi.fn().mockImplementation(async (prompt: string) => {
    // Single words always reach the preflight now; tests that care about its
    // verdict override this with mockResolvedValueOnce, which takes precedence.
    if (prompt.includes("preflight ambiguity checker")) return PREFLIGHT_PROCEED;
    if (prompt.includes("Do NOT include any translations")) return metadata;
    for (const [lang, block] of Object.entries(langBlocks)) {
      if (prompt.includes(`translation block for language "${lang}"`)) return block;
    }
    if (judgeResult !== undefined && prompt.includes("translation quality judge")) return judgeResult;
    return result;
  });
}

const defaultInput: TranslateInput = {
  word: "hello",
  sourceLang: "en",
  targetLangs: ["cs"],
  model: "openai/gpt-4o",
};

describe("translate", () => {
  it("returns a valid TranslateOutput on first pass", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    const result = await translate(defaultInput, mockGenerate);

    expect(result.status).toBe("accepted");
    expect(unwrap(result).original).toBe("hello");
    expect(unwrap(result).sourceLang).toBe("en");
    expect(unwrap(result).emoji).toBe("👋");
    expect(unwrap(result).nativeMeaning).toBeUndefined();
    expect(unwrap(result).translations.cs.text).toBe("ahoj");
  });

  it("calls generateObject once for metadata and once per target language", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    await translate(defaultInput, mockGenerate);

    // 1 metadata (which resolves the sense) + 1 language call
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it("repairs a validation failure and succeeds on second attempt", async () => {
    // Parallel calls return bad result (translation = original), then repair fixes the failing block.
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello", // same as original → semantic fail
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello, jak se máš?" }],
        },
      },
    });
    const goodResult = makeValidResult();
    const { metadata: badMeta, langBlocks: badLangs } = splitForMock(badResult);

    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce(badMeta) // metadata (parallel round 1)
      .mockResolvedValueOnce(badLangs.cs) // cs language (parallel round 1)
      .mockResolvedValueOnce(goodResult.translations.cs); // repair for cs

    const result = await translate(defaultInput, mockGenerate);

    // 2 parallel + 1 repair = 3 calls
    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("accepted");
    expect(unwrap(result).translations.cs.text).toBe("ahoj");
  });

  it("repairs only the failing target language block", async () => {
    const initialResult = makeValidResult({
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Řekl ahoj kolegovi." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
        de: {
          text: "hello",
          synonyms: [{ text: "hallo" }],
          examples: [{ context: "neutral", target: "Hello world." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    });
    const repairedGermanBlock = {
      text: "hallo",
      synonyms: [{ text: "servus" }],
      examples: [{ context: "neutral", target: "Er sagte hallo zum Kollegen." }],
      expressionType: null,
      equivalentNote: null,
      alternatives: null,
      connotationWarning: null,
    };
    const { metadata, langBlocks } = splitForMock(initialResult);

    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce(metadata) // metadata (parallel)
      .mockResolvedValueOnce(langBlocks.cs) // cs language (parallel)
      .mockResolvedValueOnce(langBlocks.de) // de language (parallel) → semantic error
      .mockResolvedValueOnce(repairedGermanBlock); // repair for de

    const result = await translate(
      {
        word: "hello",
        sourceLang: "en",
        targetLangs: ["cs", "de"],
        model: "openai/gpt-4o",
        modelRouting: {
          highRiskModel: "anthropic/claude-sonnet-4-20250514",
        },
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    // 3 parallel + 1 repair = 4 calls
    expect(mockGenerate).toHaveBeenCalledTimes(4);
    expect(unwrap(result).translations.cs.text).toBe("ahoj");
    expect(unwrap(result).translations.de.text).toBe("hallo");
    // All parallel calls use the default model
    expect(mockGenerate.mock.calls[0]?.[2]).toBe("openai/gpt-4o");
    // Repair uses high-risk model
    expect(mockGenerate.mock.calls[3]?.[2]).toBe("anthropic/claude-sonnet-4-20250514");

    const repairPrompt = mockGenerate.mock.calls[3]?.[0] as string;
    expect(repairPrompt).toContain("Targeted repair only for translations.de.");
    expect(repairPrompt).toContain("Current block:");
    expect(repairPrompt).toContain("no emoji, commentary, labels, or metadata");
    expect(repairPrompt).not.toContain("translations.cs");
  });

  it("returns needsReview=true after all retries exhausted", async () => {
    // Every call returns a bad result (translation = original)
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
        },
      },
    });

    const mockGenerate = createTranslateMock(badResult);

    const result = await translate(defaultInput, mockGenerate);

    // 2 parallel (metadata + cs) + 2 targeted repairs = 4 calls
    expect(mockGenerate).toHaveBeenCalledTimes(4);
    expect(result.status).toBe("needs_review");
  });

  it("caps the repair budget on a clarify/confirm re-run and settles to needs_review", async () => {
    // On a re-run (skipInputCorrection) the user waits behind a Telegram
    // callback, so a pathologically unfixable block gets ONE repair, not two,
    // then bails to needs_review instead of burning the full budget.
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
        },
      },
    });

    const mockGenerate = createTranslateMock(badResult);

    const result = await translate({ ...defaultInput, correctionPolicy: { skipInputCorrection: true } }, mockGenerate);

    // 2 parallel (metadata + cs) + 1 targeted repair = 3 calls (vs 4 on a first run)
    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("needs_review");
  });

  it("keeps the FULL repair budget on a first-pass translation that carries an inline context hint", async () => {
    // Regression: a first-pass `word :: context` sets `topic` but not
    // `skipInputCorrection`. It must NOT be treated as a clarify re-run — the
    // user is on a normal loader, not behind a callback — so it keeps both
    // targeted repairs (a `topic`-based rerun signal would wrongly cap it to 1).
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
        },
      },
    });

    const mockGenerate = createTranslateMock(badResult);

    const result = await translate({ ...defaultInput, topic: "finance" }, mockGenerate);

    // 2 parallel (metadata + cs) + 2 targeted repairs = 4 calls, same as a
    // first run with no hint — the inline hint does not shrink the budget.
    expect(mockGenerate).toHaveBeenCalledTimes(4);
    expect(result.status).toBe("needs_review");
  });

  it("includes topic in the prompt when provided", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    const input: TranslateInput = {
      ...defaultInput,
      topic: "medicine",
    };

    await translate(input, mockGenerate);

    // Both metadata and language prompts include the topic
    const metadataPrompt = mockGenerate.mock.calls[0][0] as string;
    expect(metadataPrompt).toContain("medicine");
  });

  it("passes the correct model to generateObject", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    await translate(defaultInput, mockGenerate);

    // All parallel calls use the same model
    expect(mockGenerate.mock.calls[0][2]).toBe("openai/gpt-4o");
  });

  it("returns needs_clarification when AI preflight finds source-language ambiguity", async () => {
    const mockGenerate = vi.fn().mockResolvedValueOnce({
      confidence: 0.41,
      outcome: "clarify_source_language",
      reasonCode: "homograph_across_languages",
      explanation: "This spelling can be English or German with different meanings.",
      options: [
        {
          id: "en",
          label: "English: quick",
          value: "en",
          kind: "source_language",
          langCode: "en",
        },
        {
          id: "de",
          label: "German: almost",
          value: "de",
          kind: "source_language",
          langCode: "de",
        },
      ],
    });

    const result = await translate(
      {
        ...defaultInput,
        word: "fast",
        sourceLang: "ru",
        targetLangs: ["en", "de"],
        nativeLang: "ru",
        interfaceLang: "en",
        detectionConfidence: 0.2,
      },
      mockGenerate,
    );

    expect(result.status).toBe("needs_clarification");
    if (result.status === "needs_clarification") {
      expect(result.ambiguity.reason).toBe("source_language");
      expect(result.ambiguity.message).toContain("English or German");
      expect(result.ambiguity.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "source_language", langCode: "en" }),
          expect.objectContaining({ kind: "source_language", langCode: "de" }),
        ]),
      );
    }
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0]?.[0]).toContain("preflight ambiguity checker");
  });

  it("continues to translation when AI preflight confidence is high", async () => {
    const goodResult = makeValidResult();
    const mockGenerate = createTranslateMock(goodResult, { issues: [], summary: "ok" }).mockResolvedValueOnce({
      confidence: 0.94,
      outcome: "proceed",
      reasonCode: "low_confidence",
      explanation: "No clarification needed.",
      options: [],
    });

    const result = await translate(
      {
        ...defaultInput,
        detectionConfidence: 0.2,
        interfaceLang: "en",
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    // 1 preflight + 2 parallel (metadata + cs) + 1 judge (high-risk due to low confidence) = 4
    expect(mockGenerate).toHaveBeenCalledTimes(4);
    expect(mockGenerate.mock.calls[0]?.[0]).toContain("preflight ambiguity checker");
    expect(mockGenerate.mock.calls[1]?.[0]).toContain("Do NOT include any translations");
  });

  it("does not ask for clarification for ordinary single-word part-of-speech ambiguity", async () => {
    const goodResult = makeValidResult();
    const mockGenerate = createTranslateMock(goodResult, { issues: [], summary: "ok" }).mockResolvedValueOnce({
      confidence: 0.45,
      outcome: "clarify_meaning",
      reasonCode: "multiple_word_senses",
      explanation: "The word can mean a patient or patient as an adjective.",
      options: [
        {
          id: "noun",
          label: "patient: noun",
          value: "person receiving medical care",
          kind: "meaning",
        },
        {
          id: "adjective",
          label: "patient: adjective",
          value: "able to wait calmly",
          kind: "meaning",
        },
      ],
    });

    const result = await translate(
      {
        ...defaultInput,
        word: "patient",
        inputType: "word",
        detectionConfidence: 0.2,
        interfaceLang: "ru",
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    expect(mockGenerate.mock.calls[0]?.[0]).toContain("preflight ambiguity checker");
    expect(mockGenerate.mock.calls[1]?.[0]).toContain("Do NOT include any translations");
  });

  it("silently corrects a minor typo and translates the corrected text (proceed_with_correction)", async () => {
    const goodResult = makeValidResult();
    const mockGenerate = createTranslateMock(goodResult, { issues: [], summary: "ok" }).mockResolvedValueOnce({
      confidence: 0.55,
      outcome: "proceed_with_correction",
      reasonCode: "probable_typo",
      explanation: "«helllo» — опечатка, исправлено на «hello».",
      correctedText: "hello",
      options: [],
    });

    const result = await translate(
      {
        ...defaultInput,
        word: "helllo",
        detectionConfidence: 0.2,
        interfaceLang: "ru",
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    const output = unwrap(result);
    // The corrected form is what was translated and what the dictionary stores.
    expect(output.original).toBe("hello");
    expect(output.correction).toEqual({
      original: "helllo",
      corrected: "hello",
      explanation: "«helllo» — опечатка, исправлено на «hello».",
    });
    // The translation prompt was built from the corrected word, not the typo.
    const metadataPrompt = mockGenerate.mock.calls[1]?.[0] as string;
    expect(metadataPrompt).toContain("hello");
    expect(metadataPrompt).not.toContain("helllo");
  });

  it("does not produce needs_clarification for a minor auto-correction", async () => {
    const goodResult = makeValidResult();
    const mockGenerate = createTranslateMock(goodResult, { issues: [], summary: "ok" }).mockResolvedValueOnce({
      confidence: 0.55,
      outcome: "proceed_with_correction",
      reasonCode: "probable_typo",
      explanation: "fixed",
      correctedText: "hello",
      options: [],
    });

    const result = await translate(
      { ...defaultInput, word: "helllo", detectionConfidence: 0.2, nativeLang: "ru" },
      mockGenerate,
    );

    expect(result.status).not.toBe("needs_clarification");
  });

  it("skips auto-correction and translates verbatim when skipInputCorrection is set", async () => {
    const goodResult = makeValidResult();
    const mockGenerate = createTranslateMock(goodResult, { issues: [], summary: "ok" }).mockResolvedValueOnce({
      confidence: 0.55,
      outcome: "proceed_with_correction",
      reasonCode: "probable_typo",
      explanation: "fixed",
      correctedText: "hello",
      options: [],
    });

    const result = await translate(
      {
        ...defaultInput,
        word: "helllo",
        detectionConfidence: 0.2,
        correctionPolicy: { skipInputCorrection: true },
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    const output = unwrap(result);
    expect(output.original).toBe("helllo");
    expect(output.correction).toBeUndefined();
  });

  it("does not re-ask about a typo (confirm_typo_suggestion) when skipInputCorrection is set", async () => {
    const goodResult = makeValidResult();
    const mockGenerate = createTranslateMock(goodResult, { issues: [], summary: "ok" }).mockResolvedValueOnce({
      confidence: 0.4,
      outcome: "confirm_typo_suggestion",
      reasonCode: "probable_typo",
      explanation: "Did you mean hello?",
      options: [
        { id: "fix", label: "hello", value: "hello", kind: "typo_correction", correctedText: "hello" },
        { id: "asis", label: "as written", value: "helllo", kind: "translate_as_written" },
      ],
    });

    const result = await translate(
      {
        ...defaultInput,
        word: "helllo",
        detectionConfidence: 0.2,
        correctionPolicy: { skipInputCorrection: true },
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    expect(unwrap(result).original).toBe("helllo");
  });

  it("still spell-checks a single word when language detection is confident", async () => {
    // Confident language detection says "this is Czech", not "this is spelled
    // right" — so the preflight runs anyway and can offer the correct form.
    const mockGenerate = createTranslateMock(makeValidResult()).mockResolvedValueOnce({
      confidence: 0.4,
      outcome: "confirm_typo_suggestion",
      reasonCode: "probable_typo",
      explanation: "This is not a Czech word.",
      options: [
        { id: "fix", label: "strohá", value: "strohá", kind: "typo_correction", correctedText: "strohá" },
        { id: "as-written", label: "Translate as written", value: "as_written", kind: "translate_as_written" },
      ],
    });

    const result = await translate(
      { ...defaultInput, word: "stroha", sourceLang: "cs", targetLangs: ["en"], detectionConfidence: 0.95 },
      mockGenerate,
    );

    expect(result.status).toBe("needs_clarification");
    if (result.status === "needs_clarification") {
      expect(result.ambiguity.reason).toBe("possible_typo");
      expect(result.ambiguity.options).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "typo_correction", correctedText: "strohá" })]),
      );
    }
    expect(mockGenerate.mock.calls[0]?.[0]).toContain("preflight ambiguity checker");
  });

  it("ignores a non-spelling preflight verdict on a confident word", async () => {
    // Confident detection reaches the preflight only for the spelling pass. English
    // "gift" is also German "Gift", and the model may say so — but that word
    // translated straight through before, and must keep doing so.
    const mockGenerate = createTranslateMock(makeValidResult()).mockResolvedValueOnce({
      confidence: 0.3,
      outcome: "clarify_source_language",
      reasonCode: "homograph_across_languages",
      explanation: "This spelling is English or German.",
      options: [
        { id: "en", label: "English", value: "en", kind: "source_language", langCode: "en" },
        { id: "de", label: "German", value: "de", kind: "source_language", langCode: "de" },
      ],
    });

    const result = await translate({ ...defaultInput, word: "gift", detectionConfidence: 0.95 }, mockGenerate);

    expect(result.status).toBe("accepted");
  });

  it("still honours a language clarification when detection itself was unsure", async () => {
    const mockGenerate = createTranslateMock(makeValidResult()).mockResolvedValueOnce({
      confidence: 0.3,
      outcome: "clarify_source_language",
      reasonCode: "homograph_across_languages",
      explanation: "This spelling is English or German.",
      options: [
        { id: "en", label: "English", value: "en", kind: "source_language", langCode: "en" },
        { id: "de", label: "German", value: "de", kind: "source_language", langCode: "de" },
      ],
    });

    const result = await translate({ ...defaultInput, word: "gift", detectionConfidence: 0.3 }, mockGenerate);

    expect(result.status).toBe("needs_clarification");
  });

  it("translates instead of asking when the preflight's only 'correction' is the input itself", async () => {
    // Reported: «Слово selmostroj не найдено в словарях» with a single button
    // "selmostroj (исправить на selmostroj)". A confirmation that offers no
    // different spelling has nothing to confirm — the existence guard on the
    // metadata call is the net for a genuinely unknown word.
    const mockGenerate = createTranslateMock(makeValidResult()).mockResolvedValueOnce({
      confidence: 0.4,
      outcome: "confirm_typo_suggestion",
      reasonCode: "probable_typo",
      explanation: "Not found in dictionaries.",
      options: [
        { id: "same", label: "hello", value: "hello", kind: "typo_correction", correctedText: "hello" },
        { id: "as-written", label: "Translate as written", value: "as_written", kind: "translate_as_written" },
      ],
    });

    const result = await translate({ ...defaultInput, detectionConfidence: 0.95 }, mockGenerate);

    expect(result.status).toBe("accepted");
  });

  it("drops a no-op correction but keeps a real one in the same confirmation", async () => {
    const mockGenerate = createTranslateMock(makeValidResult()).mockResolvedValueOnce({
      confidence: 0.4,
      outcome: "confirm_typo_suggestion",
      reasonCode: "probable_typo",
      explanation: "Two readings.",
      options: [
        { id: "same", label: "stroha", value: "stroha", kind: "typo_correction", correctedText: "stroha" },
        { id: "fix", label: "strohá", value: "strohá", kind: "typo_correction", correctedText: "strohá" },
        { id: "as-written", label: "Translate as written", value: "as_written", kind: "translate_as_written" },
      ],
    });

    const result = await translate(
      { ...defaultInput, word: "stroha", sourceLang: "cs", targetLangs: ["en"], detectionConfidence: 0.95 },
      mockGenerate,
    );

    expect(result.status).toBe("needs_clarification");
    if (result.status !== "needs_clarification") throw new Error("expected needs_clarification");
    const corrections = (result.ambiguity.options ?? []).filter((o) => o.kind === "typo_correction");
    expect(corrections.map((o) => o.correctedText)).toEqual(["strohá"]);
  });

  it("does not re-run the preflight on a confident word after the user chose to translate as written", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    await translate(
      {
        ...defaultInput,
        detectionConfidence: 0.95,
        correctionPolicy: { skipInputCorrection: true },
      },
      mockGenerate,
    );

    expect(mockGenerate.mock.calls[0]?.[0]).not.toContain("preflight ambiguity checker");
  });

  it("keeps the confidence-only gate for sentences", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    await translate(
      {
        ...defaultInput,
        word: "Kde je nejbližší zastávka autobusu?",
        inputType: "sentence",
        outputConfig: SENTENCE_OUTPUT,
        detectionConfidence: 0.95,
      },
      mockGenerate,
    );

    expect(mockGenerate.mock.calls[0]?.[0]).not.toContain("preflight ambiguity checker");
  });

  it("routes low-risk generation through the configured low-risk model", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    const result = await translate(
      {
        ...defaultInput,
        dictionaryContext: {
          word: "hello",
          pos: "noun",
          glosses: ["a greeting"],
          langCode: "en",
        },
        outputConfig: MINIMAL_OUTPUT,
        detectionConfidence: 0.95,
        modelRouting: {
          lowRiskModel: "openai/gpt-4o-mini",
          highRiskModel: "anthropic/claude-sonnet-4-20250514",
        },
      },
      mockGenerate,
    );

    // 1 preflight + 1 metadata (which resolves the sense) + 1 language call
    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(mockGenerate.mock.calls[1]?.[2]).toBe("openai/gpt-4o-mini");
    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.quality.riskLevel).toBe("low");
      expect(result.quality.modelId).toBe("openai/gpt-4o-mini");
    }
  });

  it("routes high-risk generation and judging through configured models", async () => {
    const mockGenerate = createTranslateMock(makeValidResult(), {
      issues: [],
      summary: "High-risk route passed.",
    });

    const result = await translate(
      {
        ...defaultInput,
        word: "break a leg",
        inputType: "phrase",
        modelRouting: {
          highRiskModel: "anthropic/claude-sonnet-4-20250514",
          judgeModel: "google/gemini-2.5-pro",
        },
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    // 2 parallel + 1 judge = 3 calls
    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(mockGenerate.mock.calls[0]?.[2]).toBe("anthropic/claude-sonnet-4-20250514");
    expect(mockGenerate.mock.calls[2]?.[2]).toBe("google/gemini-2.5-pro");
    if (result.status === "accepted") {
      expect(result.quality.riskLevel).toBe("high");
      expect(result.quality.modelId).toBe("anthropic/claude-sonnet-4-20250514");
    }
  });

  it("judges with a cross-family routing model when no judgeModel is configured (T21/A2)", async () => {
    const mockGenerate = createTranslateMock(makeValidResult(), { issues: [], summary: "ok" });

    const result = await translate(
      {
        ...defaultInput,
        word: "break a leg",
        inputType: "phrase",
        model: "openai/gpt-4o",
        // High-risk phrase generates with the base model (no highRiskModel set →
        // openai/gpt-4o). No judgeModel, but a different-family model is configured
        // for another tier → core picks it as the judge (rule in core, id from config).
        modelRouting: { lowRiskModel: "anthropic/claude-sonnet-4-20250514" },
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(mockGenerate.mock.calls[0]?.[2]).toBe("openai/gpt-4o");
    expect(mockGenerate.mock.calls[2]?.[2]).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("returns needs_clarification for an ambiguous numeric date before calling the model", async () => {
    const mockGenerate = vi.fn();

    const result = await translate(
      {
        word: "Let's meet on 06/07 at 5.",
        sourceLang: "en",
        targetLangs: ["de"],
        nativeLang: "ru",
        inputType: "sentence",
        outputConfig: SENTENCE_OUTPUT,
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    expect(result.status).toBe("needs_clarification");
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("returns the ambiguous date as a structured reason without a localized message (A13)", async () => {
    const mockGenerate = vi.fn();

    const result = await translate(
      {
        word: "Let's meet on 06/07 at 5.",
        sourceLang: "en",
        targetLangs: ["de"],
        nativeLang: "ru",
        inputType: "sentence",
        outputConfig: SENTENCE_OUTPUT,
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    if (result.status !== "needs_clarification") throw new Error("expected needs_clarification");
    expect(result.ambiguity.reason).toBe("date_or_time");
    // Structural preflight returns no core-authored UI string; the two date
    // interpretations remain as structured option values (data, not prose).
    expect(result.ambiguity.message).toBeUndefined();
    expect(result.ambiguity.options?.map((option) => option.value)).toEqual(["month-day", "day-month"]);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("does not hard-code lexical ambiguity for a specific sentence", async () => {
    const sentenceResult: TranslationResult = {
      emoji: "🦆",
      nativeMeaning: "Я видел, как она пригнулась.",
      nativeSynonyms: [],
      translations: {
        ru: {
          text: "Я видел, как она пригнулась.",
          synonyms: [],
          examples: [],
          expressionType: null,
          equivalentNote: null,
          usageNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    };
    const mockGenerate = createTranslateMock(sentenceResult, {
      issues: [],
      summary: "No unsupported assumptions detected.",
    });

    const result = await translate(
      {
        word: "I saw her duck.",
        sourceLang: "en",
        targetLangs: ["ru"],
        nativeLang: "cs",
        inputType: "sentence",
        outputConfig: SENTENCE_OUTPUT,
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    // Sentence output skips the empty metadata call: 1 language + 1 judge = 2 calls.
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it("runs the semantic judge for high-risk sentence translations", async () => {
    const sentenceResult: TranslationResult = {
      emoji: "🪟",
      nativeMeaning: "Вежливая просьба закрыть окно.",
      nativeSynonyms: [{ text: "просьба" }],
      translations: {
        de: {
          text: "Könntest du das Fenster schließen?",
          synonyms: [],
          examples: [],
          expressionType: null,
          equivalentNote: null,
          usageNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    };
    const mockGenerate = createTranslateMock(sentenceResult, { issues: [], summary: "ok" });

    const result = await translate(
      {
        word: "Could you close the window?",
        sourceLang: "en",
        targetLangs: ["de"],
        nativeLang: "ru",
        inputType: "sentence",
        outputConfig: SENTENCE_OUTPUT,
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    // Sentence output skips the empty metadata call: 1 language + 1 judge = 2 calls.
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    // No judgeModel configured and no cross-family routing model → judge with the
    // generator itself (core no longer hardcodes a judge model id — Fable T21/A2).
    expect(mockGenerate.mock.calls[1]?.[2]).toBe("openai/gpt-4o");
    expect(mockGenerate.mock.calls[1]?.[0]).toContain("acceptable stylistic variants");
  });

  it("keeps an ordinary unbacked word on the medium-risk path without judge", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    const result = await translate(defaultInput, mockGenerate);

    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.quality.riskLevel).toBe("medium");
      expect(result.quality.judgeResult).toBeUndefined();
    }
    // 1 metadata + 1 language = 2 parallel calls, no judge
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it("keeps a dictionary-backed confident word on the low-risk path without judge (plus the spelling preflight)", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    const result = await translate(
      {
        ...defaultInput,
        dictionaryContext: {
          word: "hello",
          pos: "noun",
          glosses: ["a greeting"],
          langCode: "en",
        },
        outputConfig: MINIMAL_OUTPUT,
        detectionConfidence: 0.93,
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.quality.riskLevel).toBe("low");
      expect(result.quality.judgeResult).toBeUndefined();
    }
    // 1 preflight + 1 metadata + 1 language, no judge
    expect(mockGenerate).toHaveBeenCalledTimes(3);
  });

  it("runs the semantic judge for phrase translations", async () => {
    const judgeResult = { issues: [], summary: "Phrase meaning, register, and assumptions are acceptable." };
    const mockGenerate = createTranslateMock(makeValidResult(), judgeResult);

    const result = await translate(
      {
        ...defaultInput,
        word: "break a leg",
        inputType: "phrase",
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.quality.riskLevel).toBe("high");
      expect(result.quality.judgeResult).toEqual(judgeResult);
    }
    // 2 parallel + 1 judge = 3 calls
    expect(mockGenerate).toHaveBeenCalledTimes(3);
    // No judgeModel configured and no cross-family routing model → judge with the
    // generator itself (core no longer hardcodes a judge model id — Fable T21/A2).
    expect(mockGenerate.mock.calls[2]?.[2]).toBe("openai/gpt-4o");
  });

  it("uses translation-safe generation settings", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    await translate(defaultInput, mockGenerate);

    // All parallel calls use the same options
    expect(mockGenerate.mock.calls[0][3]).toEqual({ frequencyPenalty: 0 });
  });

  // ─── WI-A: advisory severity for the single-word first-example check ───
  describe("advisory severity (single-word first-example)", () => {
    /** A cs block whose FIRST example does not demonstrate the single-word translation "ahoj". */
    const advisoryBlock = {
      text: "ahoj",
      synonyms: [{ text: "čau" }],
      examples: [
        { context: "neutral", target: "Dobrý den, jak se daří?" },
        { context: "colloquial", target: "Ahoj, co je?" },
        { context: "professional", target: "Ahoj, vítejte na schůzce." },
      ],
      expressionType: null,
      equivalentNote: null,
      alternatives: null,
      connotationWarning: null,
    };

    it("accepts a word whose ONLY issue is the single-word first-example mismatch, without repair or judge", async () => {
      const mockGenerate = createTranslateMock(makeValidResult({ translations: { cs: advisoryBlock } }));

      const result = await translate(defaultInput, mockGenerate);

      expect(result.status).toBe("accepted");
      if (result.status === "accepted") {
        // The issue survives as advisory (recorded, non-blocking), not blocking.
        const advisory = result.quality.issues.filter((issue) => issue.severity === "advisory");
        expect(advisory).toHaveLength(1);
        expect(advisory[0].message).toContain("[first-example]");
        expect(result.quality.issues.some((issue) => issue.severity === "blocking")).toBe(false);
      }
      // Advisory does not trigger repair, and a medium-risk word runs no judge:
      // exactly 1 metadata + 1 language call.
      expect(mockGenerate).toHaveBeenCalledTimes(2);
    });

    it("still runs the high-risk semantic judge when the only deterministic issue is advisory", async () => {
      const judgeResult = { issues: [], summary: "Meaning and register are acceptable." };
      const mockGenerate = createTranslateMock(makeValidResult({ translations: { cs: advisoryBlock } }), judgeResult);

      const result = await translate({ ...defaultInput, word: "break a leg", inputType: "phrase" }, mockGenerate);

      expect(result.status).toBe("accepted");
      if (result.status === "accepted") {
        expect(result.quality.riskLevel).toBe("high");
        // The judge was NOT suppressed by the advisory issue — it ran and answered.
        expect(result.quality.judgeResult).toEqual(judgeResult);
        expect(result.quality.issues.some((issue) => issue.severity === "advisory")).toBe(true);
      }
      // 1 metadata + 1 language + 1 judge — the judge ran despite the advisory issue.
      expect(mockGenerate).toHaveBeenCalledTimes(3);
      expect(mockGenerate.mock.calls[2]?.[0]).toContain("translation quality judge");
    });

    it("does NOT let a real semantic defect slip through: advisory + judge-blocking → needs_review", async () => {
      // The retention gate ('Auto se courá' shape): deterministic validation finds
      // only the advisory first-example issue, but the semantic judge catches a real
      // meaning error. The judge runs (advisory does not suppress it) and its blocking
      // issue routes the card to needs_review rather than a silent accept.
      const judgeResult = {
        issues: [
          {
            fieldPath: "translations.cs.text",
            severity: "blocking" as const,
            message: "Main meaning is wrong: the translation does not match the source.",
          },
        ],
        summary: "Meaning mismatch.",
      };
      const mockGenerate = createTranslateMock(makeValidResult({ translations: { cs: advisoryBlock } }), judgeResult);

      const result = await translate(
        {
          ...defaultInput,
          word: "break a leg",
          inputType: "phrase",
          // Clarify-rerun: settle to needs_review without the extra repair/re-judge cycle.
          correctionPolicy: { skipInputCorrection: true },
        },
        mockGenerate,
      );

      expect(result.status).toBe("needs_review");
      if (result.status === "needs_review") {
        expect(result.issues.some((issue) => issue.severity === "blocking")).toBe(true);
        expect(result.issues.some((issue) => issue.severity === "advisory")).toBe(true);
      }
    });
  });

  it("handles multi-language translations", async () => {
    const multiLangResult = makeValidResult({
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Řekl ahoj kolegovi." }],
        },
        de: {
          text: "hallo",
          synonyms: [{ text: "hi" }],
          examples: [{ context: "neutral", target: "Er sagte hallo zum Kollegen." }],
        },
      },
    });

    const mockGenerate = createTranslateMock(multiLangResult);

    const input: TranslateInput = {
      word: "hello",
      sourceLang: "en",
      targetLangs: ["cs", "de"],
      model: "openai/gpt-4o",
    };

    const result = await translate(input, mockGenerate);

    expect(unwrap(result).translations.cs.text).toBe("ahoj");
    expect(unwrap(result).translations.de.text).toBe("hallo");
  });

  it("preserves source usage for learning-language source words", async () => {
    const sourceUsage = {
      explanation:
        "Так называют насекомое; слово нейтральное и обычно используется в бытовом или биологическом контексте.",
      synonyms: [{ text: "nábožná kudlanka" }],
      examples: [{ context: "nature", target: "Na zahradě seděla kudlanka.", native: "В саду сидел богомол." }],
    };
    const mockGenerate = createTranslateMock(
      makeValidResult({
        nativeMeaning: "Богомол; название насекомого.",
        sourceUsage,
        nativeSynonyms: [{ text: "богомол" }],
        translations: {
          en: {
            text: "mantis",
            synonyms: [{ text: "praying mantis" }],
            examples: [{ context: "neutral", target: "I saw a mantis.", native: "Я увидел богомола." }],
            expressionType: null,
            equivalentNote: null,
            usageNote: "Нейтральный вариант для постепенного прекращения использования.",
            alternatives: null,
            connotationWarning: null,
          },
        },
      }),
    );

    const result = await translate(
      {
        word: "kudlanka",
        sourceLang: "cs",
        targetLangs: ["en"],
        nativeLang: "ru",
        inputType: "word",
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    expect(unwrap(result).sourceUsage).toEqual(sourceUsage);
    expect(unwrap(result).nativeMeaning).toBe("Богомол; название насекомого.");
  });

  it("retries when a target block connotation warning is written in the target language", async () => {
    const badResult = makeValidResult({
      nativeMeaning: "Постепенно прекратить использование.",
      translations: {
        cs: {
          text: "postupně ukončit",
          synonyms: [{ text: "zrušit postupně" }],
          examples: [
            {
              context: "neutral",
              target: "Vláda chce postupně ukončit používání plastů.",
              native: "Правительство хочет постепенно отказаться от пластика.",
            },
          ],
          expressionType: null,
          equivalentNote: null,
          usageNote: "Разговорный чешский вариант для неформальных ситуаций.",
          alternatives: null,
          connotationWarning: "Výraz je velmi neformální a může znít nezdvořile.",
        },
      },
    });

    const mockGenerate = createTranslateMock(badResult);

    const result = await translate(
      {
        word: "phase out",
        sourceLang: "en",
        targetLangs: ["cs"],
        nativeLang: "ru",
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    // 3 retry rounds × 2 parallel calls (metadata + cs) = 6 calls
    // (missing sourceUsage for learning-source word triggers schema retry loop)
    expect(mockGenerate).toHaveBeenCalledTimes(6);
    expect(result.status).toBe("needs_review");
  });

  it("accepts phase-out examples without a redundant native field in the native target block", async () => {
    const phaseOutResult = makeValidResult({
      nativeMeaning: "Постепенно прекратить использование.",
      sourceUsage: {
        explanation: "Фразовый глагол означает постепенное прекращение использования или производства.",
        synonyms: [{ text: "discontinue" }],
        examples: [
          {
            context: "policy",
            target: "The government will phase out single-use plastics.",
            native: "Правительство постепенно откажется от одноразового пластика.",
          },
        ],
      },
      nativeSynonyms: [{ text: "постепенно отказаться" }],
      translations: {
        cs: {
          text: "postupně ukončit",
          synonyms: [{ text: "postupně vyřadit" }],
          examples: [
            {
              context: "policy",
              target: "Vláda chce postupně ukončit používání plastů.",
              native: "Правительство хочет постепенно отказаться от пластика.",
            },
          ],
          expressionType: null,
          equivalentNote: null,
          usageNote: "Нейтральный чешский вариант для постепенного прекращения использования.",
          alternatives: null,
          connotationWarning: null,
        },
        ru: {
          text: "постепенно отказаться",
          synonyms: [{ text: "постепенно прекратить" }],
          examples: [
            {
              context: "policy",
              target: "Правительство хочет постепенно отказаться от пластика.",
            },
          ],
          expressionType: null,
          equivalentNote: null,
          usageNote: "Естественный русский вариант; обычно сочетается с указанием того, от чего отказываются.",
          alternatives: null,
          connotationWarning: null,
        },
      },
    });
    const mockGenerate = createTranslateMock(phaseOutResult, { issues: [], summary: "ok" });

    const result = await translate(
      {
        word: "phase out",
        sourceLang: "en",
        targetLangs: ["cs", "ru"],
        nativeLang: "ru",
        inputType: "phrase",
        model: "google/gemini-3.5-flash",
      },
      mockGenerate,
    );

    expect(unwrap(result).translations.cs.examples[0]?.native).toBe(
      "Правительство хочет постепенно отказаться от пластика.",
    );
    expect(unwrap(result).translations.ru.examples[0]?.native).toBeUndefined();
    // 3 parallel (metadata + cs + ru) + 1 judge = 4 calls
    expect(mockGenerate).toHaveBeenCalledTimes(4);
  });

  it("propagates AI adapter errors", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error("API rate limit exceeded"));

    await expect(translate(defaultInput, mockGenerate)).rejects.toThrow("API rate limit exceeded");
  });

  it("sanitizes non-emoji string in emoji field to fallback", async () => {
    setLogger(mockLogger);
    const badEmojiResult = makeValidResult({ emoji: "brittle" });
    const mockGenerate = createTranslateMock(badEmojiResult);

    const result = await translate(defaultInput, mockGenerate);

    expect(unwrap(result).emoji).toBe("🔤");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "translation.emoji_sanitized", rawEmoji: "brittle", sanitized: "🔤" }),
      "translation.emoji_sanitized",
    );
  });

  it("preserves valid emoji from AI response", async () => {
    const mockGenerate = createTranslateMock(makeValidResult({ emoji: "💎" }));

    const result = await translate(defaultInput, mockGenerate);

    expect(unwrap(result).emoji).toBe("💎");
  });
});

describe("translateOne", () => {
  it("calls translate() with single-element targetLangs", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    await translateOne(
      { word: "hello", sourceLang: "en", targetLangs: ["cs"], targetLang: "cs", model: "openai/gpt-4o" },
      mockGenerate,
    );

    // 1 metadata (which resolves the sense) + 1 language call
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it("returns the LanguageTranslation for the requested language", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    const result = await translateOne(
      { word: "hello", sourceLang: "en", targetLangs: ["cs"], targetLang: "cs", model: "openai/gpt-4o" },
      mockGenerate,
    );

    expect(unwrap(result).translations.cs?.text).toBe("ahoj");
    expect(unwrap(result).translations.cs?.synonyms).toHaveLength(1);
    expect(unwrap(result).translations.cs?.examples).toHaveLength(3);
  });

  it("propagates errors from translate()", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error("API rate limit exceeded"));

    await expect(
      translateOne(
        { word: "hello", sourceLang: "en", targetLangs: ["cs"], targetLang: "cs", model: "openai/gpt-4o" },
        mockGenerate,
      ),
    ).rejects.toThrow("API rate limit exceeded");
  });

  it("passes topic through to translate()", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    await translateOne(
      {
        word: "hello",
        sourceLang: "en",
        targetLangs: ["cs"],
        targetLang: "cs",
        model: "openai/gpt-4o",
        topic: "travel",
      },
      mockGenerate,
    );

    // Both metadata and language prompts include the topic
    const metadataPrompt = mockGenerate.mock.calls[0][0] as string;
    expect(metadataPrompt).toContain("travel");
  });

  it("passes nativeLang and inputType through to translate()", async () => {
    const resultWithNativeExamples = makeValidResult({
      nativeMeaning: "Приветствие.",
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [{ text: "čau" }],
          examples: [
            { context: "neutral", target: "Řekl ahoj svému kolegovi.", native: "Он сказал привет коллеге." },
            { context: "colloquial", target: "Ahoj, jak se máš?", native: "Привет, как дела?" },
            {
              context: "professional",
              target: "Ahoj, vítejte na schůzce.",
              native: "Здравствуйте, добро пожаловать на встречу.",
            },
          ],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    });
    const mockGenerate = createTranslateMock(resultWithNativeExamples);

    await translateOne(
      {
        word: "ahoj",
        sourceLang: "cs",
        targetLangs: ["cs"],
        targetLang: "cs",
        nativeLang: "ru",
        inputType: "word",
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    // The single-language prompt includes native translation rules
    const langPrompt = mockGenerate.mock.calls[1][0] as string;
    expect(langPrompt).toContain('"native"');
    expect(langPrompt).toContain("translation of the target example sentence");
    expect(langPrompt).toContain("natural same-language paraphrase or concise explanation");
  });

  it("passes userId through to translate()", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    await translateOne(
      { word: "hello", sourceLang: "en", targetLangs: ["cs"], targetLang: "cs", model: "openai/gpt-4o", userId: 42 },
      mockGenerate,
    );

    // userId is passed as 4th arg options to all parallel calls
    expect(mockGenerate).toHaveBeenCalledWith(expect.any(String), expect.anything(), "openai/gpt-4o", {
      frequencyPenalty: 0,
      userId: 42,
    });
  });

  it("works with needsReview results (validation exhausted)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
        },
      },
    });

    const mockGenerate = createTranslateMock(badResult);

    // translateOne still returns the LanguageTranslation even if needsReview
    const result = await translateOne(
      { word: "hello", sourceLang: "en", targetLangs: ["cs"], targetLang: "cs", model: "openai/gpt-4o" },
      mockGenerate,
    );

    expect(result.status).toBe("needs_review");
    expect(unwrap(result).translations.cs?.text).toBe("hello");
    // 2 parallel + 2 targeted repairs = 4 calls
    expect(mockGenerate).toHaveBeenCalledTimes(4);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("translateBatch", () => {
  it("translates multiple words", async () => {
    const helloResult = makeValidResult();
    const worldResult = makeValidResult({
      emoji: "🌍",
      translations: {
        cs: {
          text: "svět",
          synonyms: [{ text: "země" }],
          examples: [{ context: "neutral", target: "Svět je krásné místo." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    });
    const { metadata: helloMeta, langBlocks: helloLangs } = splitForMock(helloResult);
    const { metadata: worldMeta, langBlocks: worldLangs } = splitForMock(worldResult);

    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce(helloMeta) // word 1 metadata
      .mockResolvedValueOnce(helloLangs.cs) // word 1 cs
      .mockResolvedValueOnce(worldMeta) // word 2 metadata
      .mockResolvedValueOnce(worldLangs.cs); // word 2 cs

    const results = await translateBatch(["hello", "world"], "en", ["cs"], "openai/gpt-4o", mockGenerate);

    expect(results).toHaveLength(2);
    expect(unwrap(results[0]!).original).toBe("hello");
    expect(unwrap(results[0]!).translations.cs?.text).toBe("ahoj");
    expect(unwrap(results[1]!).original).toBe("world");
    expect(unwrap(results[1]!).translations.cs?.text).toBe("svět");
  });

  it("returns empty array for empty input", async () => {
    const mockGenerate = vi.fn();

    const results = await translateBatch([], "en", ["cs"], "openai/gpt-4o", mockGenerate);

    expect(results).toHaveLength(0);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("calls translate sequentially, not in parallel", async () => {
    const callOrder: number[] = [];
    const validResult = makeValidResult();
    const { metadata, langBlocks } = splitForMock(validResult);

    const mockGenerate = vi.fn().mockImplementation(async (prompt: string) => {
      const callNum = callOrder.length + 1;
      callOrder.push(callNum);
      // Simulate async delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (prompt.includes("Do NOT include any translations")) return metadata;
      if (prompt.includes(`translation block for language "cs"`)) return langBlocks.cs;
      return validResult;
    });

    await translateBatch(["a", "b", "c"], "en", ["cs"], "openai/gpt-4o", mockGenerate);

    // 3 words × 2 parallel calls each = 6 total, but sequential per word
    expect(callOrder).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("validation logging", () => {
  beforeEach(() => {
    vi.mocked(mockLogger.info).mockClear();
    vi.mocked(mockLogger.warn).mockClear();
    vi.mocked(mockLogger.error).mockClear();
    vi.mocked(mockLogger.debug).mockClear();
    setLogger(mockLogger);
  });

  it("calls logger.warn on each failed validation attempt", async () => {
    // Every call returns bad result (translation = original → semantic fail)
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
        },
      },
    });

    const mockGenerate = createTranslateMock(badResult);

    await translate(defaultInput, mockGenerate);

    // Semantic error breaks retry loop immediately, then repair runs.
    // logger.warn is called for the initial validation failure + repair attempts
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "translation.validation_failed",
        original: "hello",
        failReason: expect.any(String),
      }),
      "translation.validation_failed",
    );
  });

  it("calls logger.error after all retries exhausted", async () => {
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
        },
      },
    });

    const mockGenerate = createTranslateMock(badResult);

    await translate(defaultInput, mockGenerate);

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "translation.needs_review",
        original: "hello",
        failReason: expect.any(String),
      }),
      "translation.needs_review",
    );
  });

  it("does not log when validation passes on first attempt", async () => {
    const mockGenerate = createTranslateMock(makeValidResult());

    await translate(defaultInput, mockGenerate);

    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("logs warn but not error when repair succeeds", async () => {
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    });
    const goodResult = makeValidResult();
    const { metadata: badMeta, langBlocks: badLangs } = splitForMock(badResult);

    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce(badMeta) // metadata (parallel)
      .mockResolvedValueOnce(badLangs.cs) // cs language (parallel) → semantic error
      .mockResolvedValueOnce(goodResult.translations.cs); // repair for cs → fixed

    await translate(defaultInput, mockGenerate);

    // One warn for the validation failure
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "translation.validation_failed",
        original: "hello",
        failReason: expect.stringContaining("semantic"),
      }),
      "translation.validation_failed",
    );

    // No error since repair succeeded
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("includes failReason with validation error details", async () => {
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    });

    const mockGenerate = createTranslateMock(badResult);

    await translate(defaultInput, mockGenerate);

    // The failReason should describe the semantic error
    const warnCalls = (mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const validationWarn = warnCalls.find((args: unknown[]) => args[1] === "translation.validation_failed");
    expect(validationWarn).toBeDefined();
    const logObj = validationWarn![0] as { failReason: string };
    expect(logObj.failReason).toContain("hello");
    expect(logObj.failReason).toContain("identical");
  });
});

describe("parseResponse", () => {
  it("parses a valid raw response", () => {
    const raw = makeValidResult();
    const result = parseResponse(raw);

    expect(result.emoji).toBe("👋");
    expect(result.translations.cs.text).toBe("ahoj");
  });

  it("throws on invalid raw response", () => {
    expect(() => parseResponse({ invalid: true })).toThrow();
  });

  it("throws on missing required fields", () => {
    expect(() =>
      parseResponse({
        emoji: "👋",
        // missing translations
      }),
    ).toThrow();
  });

  it("throws on empty translations record", () => {
    // Empty record is valid per schema (z.record), so this should pass
    const raw = makeValidResult({ translations: {} });
    const result = parseResponse(raw);
    expect(result.translations).toEqual({});
  });
});

describe("sanitizeEmoji", () => {
  it("passes through valid single emoji", () => {
    expect(sanitizeEmoji("👋")).toBe("👋");
    expect(sanitizeEmoji("🔥")).toBe("🔥");
    expect(sanitizeEmoji("💎")).toBe("💎");
  });

  it("passes through ZWJ sequences", () => {
    expect(sanitizeEmoji("👨‍👩‍👧‍👦")).toBe("👨‍👩‍👧‍👦");
  });

  it("passes through flag emoji", () => {
    expect(sanitizeEmoji("🇷🇺")).toBe("🇷🇺");
  });

  it("replaces plain words with fallback", () => {
    expect(sanitizeEmoji("brittle")).toBe("🔤");
    expect(sanitizeEmoji("fragile")).toBe("🔤");
    expect(sanitizeEmoji("hello world")).toBe("🔤");
  });

  it("replaces empty-looking strings with fallback", () => {
    expect(sanitizeEmoji("abc")).toBe("🔤");
  });
});

/**
 * Build a mock whose metadata call also returns the Task 70 existence
 * assessment fields (sourceWordRecognized / suggestedCorrection).
 */
function createExistenceMock(
  result: TranslationResult,
  existence: { recognized: boolean; correction?: string | null },
) {
  const { metadata, langBlocks } = splitForMock(result);
  const metaWithExistence = {
    ...metadata,
    sourceWordRecognized: existence.recognized,
    suggestedCorrection: existence.correction ?? null,
  };
  return vi.fn().mockImplementation(async (prompt: string) => {
    if (prompt.includes("Do NOT include any translations")) return metaWithExistence;
    for (const [lang, block] of Object.entries(langBlocks)) {
      if (prompt.includes(`translation block for language "${lang}"`)) return block;
    }
    return result;
  });
}

describe("unrecognized-word guard (Task 70)", () => {
  const base: TranslateInput = {
    ...defaultInput,
    correctionPolicy: { assessSourceExistence: true },
    interfaceLang: "en",
  };

  it("returns an unrecognized-word clarification (not a card) with the correction offered", async () => {
    const mock = createExistenceMock(makeValidResult(), { recognized: false, correction: "strohá" });

    const decision = await translate({ ...base, word: "stroha" }, mock);

    expect(decision.status).toBe("needs_clarification");
    if (decision.status !== "needs_clarification") throw new Error("expected needs_clarification");
    expect(decision.ambiguity.reason).toBe("unrecognized_word");
    const kinds = (decision.ambiguity.options ?? []).map((o) => o.kind);
    expect(kinds).toContain("typo_correction");
    expect(kinds).toContain("translate_as_written");
    const correction = decision.ambiguity.options?.find((o) => o.kind === "typo_correction");
    expect(correction?.correctedText).toBe("strohá");
  });

  it("offers only 'translate as written' when there is no confident correction", async () => {
    const mock = createExistenceMock(makeValidResult(), { recognized: false, correction: null });

    const decision = await translate({ ...base, word: "xqzptv" }, mock);

    expect(decision.status).toBe("needs_clarification");
    if (decision.status !== "needs_clarification") throw new Error("expected needs_clarification");
    const kinds = (decision.ambiguity.options ?? []).map((o) => o.kind);
    expect(kinds).toEqual(["translate_as_written"]);
  });

  it("translates as written and flags the result unverified once the user overrides", async () => {
    const mock = createExistenceMock(makeValidResult(), { recognized: false, correction: "strohá" });

    const decision = await translate(
      { ...base, word: "stroha", correctionPolicy: { assessSourceExistence: true, skipInputCorrection: true } },
      mock,
    );

    expect(decision.status).toBe("accepted");
    expect(unwrap(decision).unverified).toBe(true);
  });

  it("produces a normal card (not flagged) when the word is recognized", async () => {
    const mock = createExistenceMock(makeValidResult(), { recognized: true, correction: null });

    const decision = await translate({ ...base, word: "hello" }, mock);

    expect(decision.status).toBe("accepted");
    expect(unwrap(decision).unverified).toBeUndefined();
  });

  it("offers the correct spelling even when the model called the word recognized", async () => {
    // The model can rationalize a non-word as a name and still know the standard
    // form; the card must never render the typed form as if it were real.
    const mock = createExistenceMock(makeValidResult(), { recognized: true, correction: "strohá" });

    const decision = await translate({ ...base, word: "stroha" }, mock);

    expect(decision.status).toBe("needs_clarification");
    if (decision.status !== "needs_clarification") throw new Error("expected needs_clarification");
    const correction = decision.ambiguity.options?.find((o) => o.kind === "typo_correction");
    expect(correction?.correctedText).toBe("strohá");
    // It called the word real, so the card must not claim the opposite.
    expect(decision.ambiguity.reason).toBe("possible_typo");
  });

  it("treats a correction that only differs in capitalization as no correction", async () => {
    const mock = createExistenceMock(makeValidResult(), { recognized: true, correction: "Hello" });

    const decision = await translate({ ...base, word: "hello" }, mock);

    expect(decision.status).toBe("accepted");
    expect(unwrap(decision).unverified).toBeUndefined();
  });

  it("treats a correction that only differs in Unicode normalization as no correction", async () => {
    // NFD "strohá" (a + combining acute) is the same text as the NFC input; a
    // button whose label is indistinguishable from what the user typed is noise.
    const mock = createExistenceMock(makeValidResult(), {
      recognized: true,
      correction: "strohá".normalize("NFD"),
    });

    const decision = await translate({ ...base, word: "strohá".normalize("NFC") }, mock);

    expect(decision.status).toBe("accepted");
  });

  it("does not gate when the caller opts out of the existence assessment", async () => {
    const mock = createExistenceMock(makeValidResult(), { recognized: false, correction: "strohá" });

    const decision = await translate({ ...defaultInput, word: "stroha", interfaceLang: "en" }, mock);

    expect(decision.status).toBe("accepted");
    expect(unwrap(decision).unverified).toBeUndefined();
  });

  it("returns a STRUCTURED reason (no localized UI string) for the channel to render (A13)", async () => {
    const mock = createExistenceMock(makeValidResult(), { recognized: false, correction: "strohá" });

    const decision = await translate({ ...base, word: "stroha" }, mock);

    if (decision.status !== "needs_clarification") throw new Error("expected needs_clarification");
    expect(decision.ambiguity.reason).toBe("unrecognized_word");
    // Core no longer localizes UI text — it returns structured params (word +
    // source-language CODE); the channel localizes via t().
    expect(decision.ambiguity.message).toBeUndefined();
    expect(decision.ambiguity.params).toEqual({ word: "stroha", lang: "en" });
    // The "translate as written" option carries no core-localized label.
    const asWritten = decision.ambiguity.options?.find((o) => o.kind === "translate_as_written");
    expect(asWritten).toBeDefined();
    expect(asWritten?.label).toBeUndefined();
  });
});

describe("buildJudgePrompt", () => {
  const request: TranslationRequest = {
    text: "hello",
    sourceLang: "en",
    targetLangs: ["cs"],
    nativeLang: "ru",
    inputType: "word",
  };

  it("keeps the judge-detection phrase used by the pipeline and tests", () => {
    // The service and its mocks identify the judge call by this exact substring.
    expect(buildJudgePrompt(request, makeValidResult())).toContain("translation quality judge");
  });

  it("whitelists the designed output-schema fields so the judge never flags them as pollution", () => {
    const prompt = buildJudgePrompt(request, makeValidResult());

    // Regression guard for the schema-confusion artifact: a lite judge model was
    // marking legitimate structured fields as "metadata not present in the source"
    // and driving every full-output translation to needs_review.
    for (const field of ["emoji", "nativeMeaning", "sourceUsage", "nativeSynonyms"]) {
      expect(prompt).toContain(`"${field}"`);
    }
    expect(prompt).toMatch(/never flag them as pollution|REQUIRED and intentional/i);
  });

  it("scopes the pollution rule to the translated text string, not the structured fields", () => {
    const prompt = buildJudgePrompt(request, makeValidResult());

    // The emoji/label/explanation pollution rule must target translations.<lang>.text,
    // and must explicitly exclude the structured schema fields.
    expect(prompt).toMatch(/only to the translated "text" string|never to the structured schema fields/i);
  });

  it("still asks for the genuine factual and immutable-token blocking rules", () => {
    const prompt = buildJudgePrompt(request, makeValidResult());

    expect(prompt).toMatch(/wrong main meaning/i);
    expect(prompt).toMatch(/negation/i);
    expect(prompt).toMatch(/immutable tokens/i);
    expect(prompt).toMatch(/placeholders/i);
  });
});

describe("sense anchor", () => {
  const wordInput: TranslateInput = {
    word: "wasted",
    sourceLang: "en",
    targetLangs: ["cs"],
    nativeLang: "ru",
    model: "openai/gpt-4o",
  };

  // Fixtures complete enough to pass validation on their own, so these tests
  // exercise the anchor instead of incidentally driving retries and repair.
  // A learning-source request (en → ru native) requires sourceUsage.
  const metadataFixture = {
    emoji: "🥴",
    nativeMeaning: "сильное алкогольное опьянение",
    sourceUsage: {
      headword: "wasted",
      explanation: "разг. сильно пьяный",
      synonyms: [{ text: "drunk" }],
      examples: [{ context: "colloquial", target: "He got wasted.", native: "Он напился." }],
    },
    nativeSynonyms: [{ text: "пьяный" }],
  };

  const cleanBlockFor = (lang: string) => ({
    ...cleanBlock,
    text: `${cleanBlock.text}-${lang}`,
    usageNote: `${cleanBlock.usageNote} (${lang})`,
  });

  const cleanBlock = {
    text: "sjetý",
    synonyms: [{ text: "opilý" }],
    examples: [
      { context: "colloquial", target: "Byl úplně sjetý.", native: "Он был в стельку пьян." },
      { context: "colloquial", target: "Včera se namol opil.", native: "Вчера он напился в хлам." },
      { context: "neutral", target: "Přišel domů opilý.", native: "Он пришёл домой пьяным." },
    ],
    expressionType: "literal" as const,
    equivalentNote: null,
    usageNote: "Разговорное слово о сильном опьянении.",
    alternatives: null,
    connotationWarning: null,
  };

  function isMetadataPrompt(prompt: string): boolean {
    return prompt.includes("Do NOT include any translations");
  }

  function targetLangOf(prompt: string): string {
    return prompt.match(/translation block for language "([^"]+)"/)?.[1] ?? "cs";
  }

  it("resolves the sense on the metadata call and anchors the language prompts to it", async () => {
    const metadata = metadataFixture;
    const prompts: string[] = [];
    const mockGenerate = vi.fn().mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      if (isMetadataPrompt(prompt)) {
        return { ...metadata, primarySense: "intoxicated by alcohol or drugs (slang)" };
      }
      return cleanBlockFor(targetLangOf(prompt));
    });

    await translate(wordInput, mockGenerate);

    const languagePrompt = prompts.find((p) => !isMetadataPrompt(p));
    expect(languagePrompt).toContain("intoxicated by alcohol or drugs (slang)");
  });

  it("does not start a language call before the sense is known", async () => {
    const metadata = metadataFixture;
    let releaseMetadata: (() => void) | undefined;
    const metadataGate = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });
    let languageCallStarted = false;
    let metadataCallStarted = false;

    const mockGenerate = vi.fn().mockImplementation(async (prompt: string) => {
      if (isMetadataPrompt(prompt)) {
        metadataCallStarted = true;
        await metadataGate;
        return { ...metadata, primarySense: "drunk (slang)" };
      }
      languageCallStarted = true;
      return cleanBlockFor(targetLangOf(prompt));
    });

    const pending = translate(wordInput, mockGenerate);
    // Let the metadata call start and every already-scheduled task drain: a
    // parallel fan-out would have started the language call by now.
    while (!metadataCallStarted) await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(languageCallStarted).toBe(false);

    releaseMetadata?.();
    await pending;
    expect(languageCallStarted).toBe(true);
  });

  it("keeps the anchor out of the returned card", async () => {
    const metadata = metadataFixture;
    const mockGenerate = vi.fn().mockImplementation(async (prompt: string) => {
      if (isMetadataPrompt(prompt)) return { ...metadata, primarySense: "drunk (slang)" };
      return cleanBlockFor(targetLangOf(prompt));
    });

    const output = unwrap(await translate(wordInput, mockGenerate));

    expect(JSON.stringify(output)).not.toContain("primarySense");
  });

  it("translates unanchored when the metadata call returns no sense", async () => {
    const metadata = metadataFixture;
    const prompts: string[] = [];
    const mockGenerate = vi.fn().mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      if (isMetadataPrompt(prompt)) return metadata;
      return cleanBlockFor(targetLangOf(prompt));
    });

    // No nativeLang: the fixture block carries no native example translations,
    // which a native-language request would (correctly) flag on its own.
    const result = await translate(
      { word: "hello", sourceLang: "en", targetLangs: ["cs"], model: "openai/gpt-4o" },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    expect(prompts.find((p) => !isMetadataPrompt(p))).not.toContain("SENSE ANCHOR");
  });

  it("anchors the targeted repair prompt too", async () => {
    // Schema-complete on purpose: a schema error would restart the whole batch,
    // while this semantic defect is what routes to the targeted repair path.
    const badBlock = { ...cleanBlock, text: "wasted" };
    const metadata = metadataFixture;
    const prompts: string[] = [];
    let languageCalls = 0;
    const mockGenerate = vi.fn().mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      if (isMetadataPrompt(prompt)) return { ...metadata, primarySense: "drunk (slang)" };
      languageCalls++;
      return languageCalls === 1 ? badBlock : cleanBlockFor(targetLangOf(prompt));
    });

    await translate(wordInput, mockGenerate);

    const repairPrompt = prompts.find((p) => p.includes("Targeted repair only"));
    expect(repairPrompt).toBeDefined();
    expect(repairPrompt).toContain("drunk (slang)");
  });

  it("leaves sentence translation on the unanchored path", async () => {
    // A sentence with a native language still runs the metadata call (it carries
    // nativeMeaning), so this exercises the inputType gate rather than passing
    // merely because no metadata call happened.
    const metadata = metadataFixture;
    const prompts: string[] = [];
    const mockGenerate = vi.fn().mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      if (isMetadataPrompt(prompt)) return metadata;
      return cleanBlockFor(targetLangOf(prompt));
    });

    await translate({ ...wordInput, word: "Včera se úplně zničil.", inputType: "sentence" }, mockGenerate);

    const metadataPrompt = prompts.find(isMetadataPrompt);
    expect(metadataPrompt).toBeDefined();
    expect(metadataPrompt).not.toContain("primarySense");
    expect(prompts.every((p) => !p.includes("SENSE ANCHOR"))).toBe(true);
  });

  it("gives every target language the same anchor", async () => {
    const metadata = metadataFixture;
    const prompts: string[] = [];
    const mockGenerate = vi.fn().mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      if (isMetadataPrompt(prompt)) return { ...metadata, primarySense: "intoxicated (slang)" };
      return cleanBlockFor(targetLangOf(prompt));
    });

    await translate({ ...wordInput, targetLangs: ["cs", "de"] }, mockGenerate);

    // 1 metadata + 2 language calls: no hidden retry or repair round inflating this.
    expect(mockGenerate).toHaveBeenCalledTimes(3);
    const anchorLines = prompts
      .filter((p) => !isMetadataPrompt(p))
      .map((p) => p.split("\n").find((line) => line.startsWith("SENSE ANCHOR")));
    expect(anchorLines).toHaveLength(2);
    expect(new Set(anchorLines).size).toBe(1);
    expect(anchorLines[0]).toContain("intoxicated (slang)");
  });

  it("tells the judge which sense the card committed to", () => {
    const request: TranslationRequest = {
      text: "wasted",
      sourceLang: "en",
      targetLangs: ["cs"],
      senseAnchor: "intoxicated by alcohol or drugs (slang)",
    };

    const prompt = buildJudgePrompt(request, makeValidResult());

    expect(prompt).toContain("intoxicated by alcohol or drugs (slang)");
    // Without this the judge blocks a deliberately-chosen minority sense as a
    // "wrong main meaning" — and multi-gloss words always reach the judge.
    expect(prompt).toContain("never a");
  });

  it("does not mention a sense to the judge when the card was not anchored", () => {
    const prompt = buildJudgePrompt({ text: "hello", sourceLang: "en", targetLangs: ["cs"] }, makeValidResult());
    expect(prompt).not.toContain("Sense anchor");
  });
});

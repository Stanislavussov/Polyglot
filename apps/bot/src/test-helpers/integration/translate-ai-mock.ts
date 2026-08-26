/**
 * Deterministic AI mock for the translate pipeline (Task 71, Phases 4–5).
 *
 * Returns fat, schema-shaped fixtures by matching each requested Zod schema, so it
 * satisfies every step of `translate()` (preflight → metadata + per-language
 * generation → optional judge → finalize) without depending on call order.
 * Returning `parsed.data` keeps the mock type-safe (no casts). Extra keys on a
 * fixture are stripped by Zod `.object()`, so one fat object per schema is enough.
 *
 * The fixtures follow the verified schema contract in
 * `packages/core/src/modules/translation` (metadata requires `sourceWordRecognized`
 * and, for word input, `primarySense`; per-language requires `text` + `examples`;
 * preflight requires `outcome`).
 */
import type { AIPort } from "@polyglot/core";

const PREFLIGHT_PROCEED = {
  confidence: 1,
  outcome: "proceed",
  reasonCode: "low_confidence",
  explanation: "ok",
  options: [],
};
const JUDGE_CLEAN = { issues: [], summary: null };
const METADATA_FAT = {
  emoji: "👋",
  nativeMeaning: "greeting",
  sourceUsage: {
    explanation: "a greeting",
    synonyms: [{ text: "hi" }],
    examples: [{ context: "greeting", target: "hello there", native: "greeting" }],
  },
  nativeSynonyms: [{ text: "hi" }],
  primarySense: "a spoken greeting on meeting someone",
  sourceWordRecognized: true,
  suggestedCorrection: null,
};
const LANGUAGE_FAT = {
  text: "ahoj",
  synonyms: [{ text: "nazdar" }],
  examples: [{ context: "greeting", target: "Ahoj!", native: "Hi!" }],
  expressionType: "literal",
  equivalentNote: null,
  usageNote: "informal greeting",
  alternatives: null,
  connotationWarning: null,
};

export interface TranslateAiOptions {
  /**
   * Headword the metadata fixture reports as NOT a real word, which drives the
   * pipeline's unrecognized-word guard to `needs_clarification`. Matched against the
   * prompt (which carries the headword), so a test can send one word into the
   * clarification branch and another straight to a card with the same mock.
   */
  unrecognizedWord?: string;
  /**
   * Makes the preflight fixture report `misspelled` as a probable typo with
   * `correctedText` offered, driving the preflight branch of the clarification.
   */
  typoSuggestion?: { misspelled: string; correctedText: string };
}

/** An AI override (for the harness `ai` option) that drives translate() to an accepted card. */
export function deterministicTranslateAi(options: TranslateAiOptions = {}): Partial<AIPort> {
  const generateObject: AIPort["generateObject"] = async (prompt, schema) => {
    const metadata =
      options.unrecognizedWord && prompt.includes(options.unrecognizedWord)
        ? { ...METADATA_FAT, sourceWordRecognized: false, suggestedCorrection: null }
        : METADATA_FAT;
    const typo = options.typoSuggestion;
    const preflight =
      typo && prompt.includes(typo.misspelled)
        ? {
            confidence: 0.4,
            outcome: "confirm_typo_suggestion",
            reasonCode: "probable_typo",
            explanation: "That spelling is not a word.",
            options: [
              {
                id: "fix",
                label: typo.correctedText,
                value: typo.correctedText,
                kind: "typo_correction",
                correctedText: typo.correctedText,
              },
              { id: "as-written", label: "Translate as written", value: "as_written", kind: "translate_as_written" },
            ],
          }
        : PREFLIGHT_PROCEED;
    for (const fixture of [preflight, JUDGE_CLEAN, metadata, LANGUAGE_FAT]) {
      const parsed = schema.safeParse(fixture);
      if (parsed.success) return parsed.data;
    }
    throw new Error("translate-ai-mock: no fixture matched the requested schema");
  };
  return {
    generateObject,
    // Language detection may escalate to an AI call; a deterministic source code
    // keeps the happy path in-set (native/learning langs).
    generateText: async () => "en",
  };
}

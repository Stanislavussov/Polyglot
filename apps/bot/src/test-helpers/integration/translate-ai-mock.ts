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
 * `packages/core/src/modules/translation` (metadata requires `sourceWordRecognized`,
 * per-language requires `text` + `examples`, preflight requires `outcome`).
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

/** An AI override (for the harness `ai` option) that drives translate() to an accepted card. */
export function deterministicTranslateAi(): Partial<AIPort> {
  const generateObject: AIPort["generateObject"] = async (_prompt, schema) => {
    for (const fixture of [PREFLIGHT_PROCEED, JUDGE_CLEAN, METADATA_FAT, LANGUAGE_FAT]) {
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

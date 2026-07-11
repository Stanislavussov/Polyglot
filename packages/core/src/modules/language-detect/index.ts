// Re-export ContextLookupFn from context-enrichment (avoids circular imports)
export type { ContextLookupFn } from "../context-enrichment/types.js";
export type {
  AIGenerateFn,
  AIOpenDetection,
  LanguageDetectionStrategy,
} from "./detect-language.js";
export {
  AIStrategy,
  DiacriticsStrategy,
  // Main functions
  detectLanguage,
  detectLanguageAsync,
  detectLanguageWithConfidence,
  detectLanguageWithConfidenceAsync,
  detectOutOfSetByAlphabet,
  detectOutOfSetLanguage,
  FrancStrategy,
  ISO1_TO_ISO3,
  needsAiArbitration,
  needsDictionaryVerification,
  // Strategy classes
  ScriptStrategy,
  WiktionaryStrategy,
} from "./detect-language.js";
export {
  resolveDirectionFromSource,
  resolveTranslationDirection,
} from "./resolve-direction.js";
export type {
  DetectionEvidence,
  DetectionResult,
  FindWordLanguagesFn,
  ResolveDirectionInput,
  ResolveFromSourceInput,
  TranslationDirection,
} from "./types.js";

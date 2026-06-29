// Re-export ContextLookupFn from context-enrichment (avoids circular imports)
export type { ContextLookupFn } from "../context-enrichment/types.js";
export type {
  AIGenerateFn,
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
  detectOutOfSetLanguage,
  FrancStrategy,
  ISO1_TO_ISO3,
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
  ResolveDirectionInput,
  ResolveFromSourceInput,
  TranslationDirection,
} from "./types.js";

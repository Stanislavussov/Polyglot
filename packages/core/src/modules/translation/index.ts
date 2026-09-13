// Translation service — public API

// Output presets
export {
  FULL_OUTPUT,
  MINIMAL_OUTPUT,
  NOTIFICATION_OUTPUT,
  RELIABLE_OUTPUT,
  SENTENCE_OUTPUT,
} from "../../shared/translation-output.presets.js";
// Etymology
export type { EtymologyInput } from "./etymology.service.js";
export { generateEtymology } from "./etymology.service.js";
// Language traits
export type { LanguageTraits } from "./language-traits.js";
export { buildLanguageTraitsHint, getLanguageTraits, LANGUAGE_TRAITS } from "./language-traits.js";
export type { PreflightScoringConfig } from "./preflight.config.js";
export { PREFLIGHT_DEFAULTS } from "./preflight.config.js";
export type { PreflightResult } from "./preflight.schema.js";
export { preflightResultSchema } from "./preflight.schema.js";
// Prompt builder
export { buildStrictPrompt, buildTranslationPrompt } from "./prompt.builder.js";
export type {
  LanguageTranslationInput,
  SynonymInput,
  TranslationExampleInput,
  TranslationRequestInput,
  TranslationResultInput,
  TranslationVariantInput,
} from "./schemas/translation.schema.js";
// Schemas
export {
  buildLanguageTranslationSchema,
  buildTranslationResultSchema,
  exampleSchema,
  languageTranslationSchema,
  synonymSchema,
  translationRequestSchema,
  translationResultSchema,
  translationVariantSchema,
} from "./schemas/translation.schema.js";
export {
  buildPrompt,
  parseResponse,
  translate,
  translateBatch,
  translateOne,
} from "./translation.service.js";
// Types
export type {
  DictionaryContext,
  Example,
  ExpressionType,
  InputCorrection,
  InputType,
  LanguageTranslation,
  QualityIssue,
  QualityIssueSeverity,
  QualityMetadata,
  RiskLevel,
  SourceUsage,
  Synonym,
  TranslateInput,
  TranslateOutput,
  TranslationAmbiguity,
  TranslationAmbiguityOption,
  TranslationAmbiguityReason,
  TranslationDecision,
  TranslationModelRoutingPolicy,
  TranslationOutputConfig,
  TranslationRequest,
  TranslationResult,
  TranslationVariant,
} from "./types.js";

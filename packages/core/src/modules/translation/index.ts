// Translation service — public API

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
export type { GenerateObjectFn } from "./translation.service.js";
export {
  buildPrompt,
  parseResponse,
  translate,
  translateBatch,
  translateOne,
} from "./translation.service.js";
// Output presets
export {
  FULL_OUTPUT,
  MINIMAL_OUTPUT,
  NOTIFICATION_OUTPUT,
  RELIABLE_OUTPUT,
  SENTENCE_OUTPUT,
} from "./translation-output.presets.js";
// Types
export type {
  DictionaryContext,
  Example,
  ExpressionType,
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
  TranslationOutputConfig,
  TranslationRequest,
  TranslationResult,
  TranslationVariant,
} from "./types.js";

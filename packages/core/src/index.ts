// Logger — singleton pino, also exported from here for convenience

export type { Logger } from "./logger-interface.js";
export { getLogger, setLogger } from "./logger-interface.js";
export { logger } from "./logger.js";

// Modules

export * from "./modules/context-enrichment/index.js";
export * from "./modules/dictionary-pipeline/index.js";
export * from "./modules/i18n/index.js";
export type {
  AnalyzeInput,
  IdiomAnalysisInput,
  IdiomAnalysisResult,
  IdiomClassification,
  SourceExpressionType,
} from "./modules/idiom-analysis/index.js";
// Idiom analysis — GenerateObjectFn is also exported from translation, so we
// re-export everything except the duplicate to avoid TS2308.
export {
  analyzeIdiom,
  analyzeIdiomBatch,
  buildIdiomAnalysisPrompt,
  idiomAnalysisResultSchema,
  idiomClassificationSchema,
  needsIdiomReview,
  sourceExpressionTypeSchema,
} from "./modules/idiom-analysis/index.js";
export * from "./modules/language-detect/index.js";
export * from "./modules/topics/index.js";
export * from "./modules/translation/index.js";
export type {
  ExampleInput,
  ValidateInput,
  ValidationError,
  ValidationResult,
} from "./modules/validation/index.js";
// Validation — ExpressionType is also exported from translation, so we
// re-export everything except the duplicate to avoid TS2308.
export {
  validate,
  validateExamples,
  validateLanguage,
  validateSchema,
  validateSemantic,
} from "./modules/validation/index.js";

// Shared
export * from "./shared/errors.js";
export type { InputContext } from "./shared/translation-template.service.js";
export { MAX_TRANSCRIPTION_INPUT_LENGTH, resolveOutputConfig, resolveTemplate } from "./shared/translation-template.service.js";
export type {
  TemplateFields,
  UserTranslationTemplate,
} from "./shared/translation-template.types.js";
export {
  DEFAULT_TEMPLATE,
  TEMPLATE_FIELD_KEYS,
  templateToOutputConfig,
} from "./shared/translation-template.types.js";

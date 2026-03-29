// Logger

export type { Logger } from "./logger.js";
export { getLogger, setLogger } from "./logger.js";

// Modules

export * from "./modules/context-enrichment/index.js";
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

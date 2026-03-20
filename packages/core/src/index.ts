// Modules
export * from "./modules/translation/index.js";
export * from "./modules/topics/index.js";
export * from "./modules/context-enrichment/index.js";
// Idiom analysis — GenerateObjectFn is also exported from translation, so we
// re-export everything except the duplicate to avoid TS2308.
export {
  analyzeIdiom,
  analyzeIdiomBatch,
  needsIdiomReview,
  idiomClassificationSchema,
  sourceExpressionTypeSchema,
  idiomAnalysisResultSchema,
  buildIdiomAnalysisPrompt,
} from "./modules/idiom-analysis/index.js";
export type {
  AnalyzeInput,
  IdiomClassification,
  SourceExpressionType,
  IdiomAnalysisInput,
  IdiomAnalysisResult,
} from "./modules/idiom-analysis/index.js";

// Validation — ExpressionType is also exported from translation, so we
// re-export everything except the duplicate to avoid TS2308.
export {
  validateSchema,
  validateSemantic,
  validateLanguage,
  resolveToIso3,
  validateExamples,
  validate,
} from "./modules/validation/index.js";
export type {
  ExampleInput,
  ValidationResult,
  ValidationError,
  ValidateInput,
} from "./modules/validation/index.js";

export * from "./modules/i18n/index.js";

// Shared
export * from "./shared/errors.js";

// Modules
export * from "./modules/translation/index.js";
export * from "./modules/topics/index.js";

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

export type { InputType, ValidateInput, ValidateOptions, ValidationError, ValidationResult } from "./types.js";
export { validate } from "./validation.service.js";
export type { ExampleInput, ExpressionType } from "./validators/example.validator.js";
export { validateExamples } from "./validators/example.validator.js";
export { validateNativeFields } from "./validators/field-language.validator.js";
export { validateImmutableContent } from "./validators/immutable.validator.js";
export { validateSchema } from "./validators/schema.validator.js";
export { validateSemantic } from "./validators/semantic.validator.js";
export type {
  KnownPos,
  WiktionaryEntryInput,
  WordContextInput,
} from "./validators/wiktionary.validator.js";
export {
  KNOWN_POS,
  validateGlosses,
  validatePos,
  validateWiktionaryEntry,
  validateWordContext,
} from "./validators/wiktionary.validator.js";

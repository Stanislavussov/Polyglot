// Translation service — public API
export {
  translate,
  translateOne,
  translateBatch,
  parseResponse,
  buildPrompt,
} from "./translation.service.js";
export type { GenerateObjectFn } from "./translation.service.js";

// Prompt builder
export { buildTranslationPrompt, buildStrictPrompt } from "./prompt.builder.js";

// Schemas
export {
  translationRequestSchema,
  translationResultSchema,
  buildTranslationResultSchema,
  languageTranslationSchema,
  synonymSchema,
  exampleSchema,
} from "./schemas/translation.schema.js";
export type {
  TranslationRequestInput,
  TranslationResultInput,
  LanguageTranslationInput,
  SynonymInput,
  TranslationExampleInput,
} from "./schemas/translation.schema.js";

// Types
export type {
  TranslationRequest,
  TranslationResult,
  TranslateInput,
  TranslateOutput,
  LanguageTranslation,
  Synonym,
  Example,
  Register,
  CefrLevel,
  ExampleContext,
  ExpressionType,
  DictionaryContext,
} from "./types.js";

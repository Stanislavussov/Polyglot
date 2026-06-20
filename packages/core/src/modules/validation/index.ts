export type { InputType, ValidateInput, ValidateOptions, ValidationError, ValidationResult } from "./types.js";
export type { ExampleInput, ExpressionType } from "./validators/example.validator.js";
export { validateExamples } from "./validators/example.validator.js";
export { validateNativeFields } from "./validators/field-language.validator.js";
export { validateLanguage } from "./validators/language.validator.js";
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

import type { ZodSchema } from "zod";
import type { InputType, ValidateOptions, ValidationError, ValidationResult } from "./types.js";
import type { ExpressionType } from "./validators/example.validator.js";
import { validateExamples } from "./validators/example.validator.js";
import { validateNativeFields } from "./validators/field-language.validator.js";
import { validateLanguage } from "./validators/language.validator.js";
import { validateSchema } from "./validators/schema.validator.js";
import { validateSemantic } from "./validators/semantic.validator.js";

/**
 * Orchestrated validation: runs all validators in sequence.
 *
 * 1. Schema validation (Zod) — structural check
 * 2. Semantic validation — translation ≠ original, no hallucinations
 * 3. Language detection — via franc-min
 * 4. Example quality — examples contain the translated word
 * 5. Alternatives semantic validation — alternatives ≠ original, no hallucinations
 *
 * Validation is driven by `ValidateOptions` (mirrors TranslationOutputConfig):
 * - `includeExamples: false` → step 4 is skipped
 * - `includeAlternatives: false` → step 5 is skipped
 *
 * When `inputType` is `'sentence'`, semantic validation (steps 2, 4, 5) is
 * skipped entirely. Sentence translations are naturally more similar to
 * originals when source/target languages share vocabulary, and the
 * "translation ≠ original" check is not meaningful for sentences.
 *
 * Returns a merged ValidationResult with errors from all checks.
 *
 * Pure function — no side effects, no I/O.
 */
export function validate(
  raw: unknown,
  schema: ZodSchema,
  original: string,
  expectedLangs: string[],
  inputType?: InputType,
  options?: ValidateOptions,
): ValidationResult {
  const allErrors: ValidationError[] = [];

  // Step 1: Schema validation
  const schemaResult = validateSchema(raw, schema);
  allErrors.push(...schemaResult.errors);

  // If schema fails, we can't safely inspect the content
  if (!schemaResult.valid) {
    return { valid: false, errors: allErrors };
  }

  // At this point raw is valid per schema — cast to inspectable shape
  const parsed = raw as Record<string, unknown>;
  if (options?.nativeLang) {
    const nativeMeaning = parsed.nativeMeaning;
    if (typeof nativeMeaning !== "string" || nativeMeaning.trim().length === 0) {
      allErrors.push({
        rule: "schema",
        message: "nativeMeaning is required when nativeLang is provided",
        field: "nativeMeaning",
      });
    }
  }

  const translations = parsed.translations as Record<string, Record<string, unknown>> | undefined;

  if (!translations || typeof translations !== "object") {
    return { valid: allErrors.length === 0, errors: allErrors };
  }

  if (options?.nativeLang) {
    const nativeFieldsResult = validateNativeFields(parsed, translations, expectedLangs, options.nativeLang);
    allErrors.push(...nativeFieldsResult.errors);
  }

  const isSentence = inputType === "sentence";

  // Step 2–4: Per-language checks
  for (const lang of expectedLangs) {
    const langData = translations[lang];
    if (!langData) {
      allErrors.push({
        rule: "schema",
        message: `Missing translation for expected language: "${lang}"`,
        field: `translations.${lang}`,
      });
      continue;
    }

    const translationText = langData.text as string | undefined;

    // The native-language target block is minimal (text + synonyms only) when
    // the source is a learning language: the user already knows their native
    // language, so examples/alternatives/notes are not generated and must not
    // be validated. Schema validation already enforced the minimal shape.
    const isMinimalNativeTarget =
      options?.nativeLang !== undefined && lang === options.nativeLang && options.sourceLang !== options.nativeLang;

    if ("transcription" in langData) {
      allErrors.push({
        rule: "schema",
        message: "Transcription/pronunciation fields are not allowed",
        field: `translations.${lang}.transcription`,
      });
    }

    // Step 2: Semantic validation
    // Skipped for sentences — sentence translations are naturally more similar
    // to originals and the "translation ≠ original" check is not meaningful.
    if (translationText && !isSentence) {
      const isSameLanguageTarget = lang === options?.sourceLang;
      const semanticResult = validateSemantic(original, translationText);
      for (const err of semanticResult.errors) {
        allErrors.push({
          ...err,
          field: `translations.${lang}.${err.field ?? "text"}`,
        });
      }

      if (isSameLanguageTarget && sameExpression(original, translationText)) {
        allErrors.push({
          rule: "semantic",
          message: `Same-language translation for "${lang}" must not repeat the original expression "${original}"`,
          field: `translations.${lang}.text`,
        });
      }
    }

    // Step 3: Language detection
    if (translationText && !isMinimalNativeTarget) {
      const langResult = validateLanguage(translationText, lang);
      for (const err of langResult.errors) {
        allErrors.push({
          ...err,
          field: `translations.${lang}.${err.field ?? "text"}`,
        });
      }
    }

    // Step 4: Example validation
    // Skipped when: inputType='sentence', outputConfig disabled examples,
    // or this is the minimal native target block (no examples generated).
    const examples = langData.examples as
      | Array<{ context: string; target: string; native?: string | null }>
      | undefined;
    const expressionType = langData.expressionType as ExpressionType | undefined;
    const skipExamples = isSentence || options?.includeExamples === false || isMinimalNativeTarget;

    if (examples && Array.isArray(examples) && translationText && !skipExamples) {
      const exampleResult = validateExamples(examples, translationText, expressionType);
      for (const err of exampleResult.errors) {
        allErrors.push({
          ...err,
          field: `translations.${lang}.${err.field ?? "examples"}`,
        });
      }
    }

    // Step 5: Alternatives semantic validation
    // Skipped when: inputType='sentence', outputConfig disabled alternatives,
    // or this is the minimal native target block (no alternatives generated).
    const alternatives = langData.alternatives as Array<{ text: string }> | undefined;
    const skipAlternatives = isSentence || options?.includeAlternatives === false || isMinimalNativeTarget;

    if (alternatives && Array.isArray(alternatives) && !skipAlternatives) {
      for (let i = 0; i < alternatives.length; i++) {
        const alt = alternatives[i];
        if (alt && typeof alt.text === "string") {
          const altResult = validateSemantic(original, alt.text);
          for (const err of altResult.errors) {
            allErrors.push({
              ...err,
              field: `translations.${lang}.alternatives[${i}].${err.field ?? "text"}`,
            });
          }
        }
      }
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

function sameExpression(original: string, translation: string): boolean {
  return normalizeExpression(original) === normalizeExpression(translation);
}

function normalizeExpression(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

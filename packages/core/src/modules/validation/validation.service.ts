import type { ZodSchema } from "zod";
import type { InputType, ValidateOptions, ValidationError, ValidationResult } from "./types.js";
import type { ExpressionType } from "./validators/example.validator.js";
import { validateExamples } from "./validators/example.validator.js";
import { validateNativeFields } from "./validators/field-language.validator.js";
import { validateImmutableContent } from "./validators/immutable.validator.js";
import { validateLanguage } from "./validators/language.validator.js";
import { validateSchema } from "./validators/schema.validator.js";
import { validateSemantic } from "./validators/semantic.validator.js";

/**
 * Runs structural, semantic, immutable-content, language, example, and
 * alternative validation for every requested target language.
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

  const schemaResult = validateSchema(raw, schema);
  allErrors.push(...schemaResult.errors);

  if (!schemaResult.valid) {
    return { valid: false, errors: allErrors };
  }

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
    const isMinimalNativeTarget =
      options?.nativeLang !== undefined && lang === options.nativeLang && options.sourceLang !== options.nativeLang;

    if ("transcription" in langData) {
      allErrors.push({
        rule: "schema",
        message: "Transcription/pronunciation fields are not allowed",
        field: `translations.${lang}.transcription`,
      });
    }

    if (translationText) {
      const semanticResult = validateSemantic(original, translationText, {
        allowIdentical: isSentence,
      });
      for (const error of semanticResult.errors) {
        allErrors.push({
          ...error,
          field: `translations.${lang}.${error.field ?? "text"}`,
        });
      }

      const isSameLanguageTarget = lang === options?.sourceLang;
      if (isSameLanguageTarget && sameExpression(original, translationText)) {
        allErrors.push({
          rule: "semantic",
          message: `Same-language translation for "${lang}" must not repeat the original expression "${original}"`,
          field: `translations.${lang}.text`,
        });
      }

      const immutableResult = validateImmutableContent(original, translationText);
      for (const error of immutableResult.errors) {
        allErrors.push({
          ...error,
          field: `translations.${lang}.${error.field ?? "text"}`,
        });
      }
    }

    if (translationText && !isMinimalNativeTarget) {
      const languageResult = validateLanguage(translationText, lang);
      for (const error of languageResult.errors) {
        allErrors.push({
          ...error,
          field: `translations.${lang}.${error.field ?? "text"}`,
        });
      }
    }

    const examples = langData.examples as
      | Array<{ context: string; target: string; native?: string | null }>
      | undefined;
    const expressionType = langData.expressionType as ExpressionType | undefined;
    const skipExamples = isSentence || options?.includeExamples === false || isMinimalNativeTarget;

    if (examples && Array.isArray(examples) && translationText && !skipExamples) {
      const exampleResult = validateExamples(examples, translationText, expressionType);
      for (const error of exampleResult.errors) {
        allErrors.push({
          ...error,
          field: `translations.${lang}.${error.field ?? "examples"}`,
        });
      }
    }

    const alternatives = langData.alternatives as Array<{ text: string }> | undefined;
    const skipAlternatives = isSentence || options?.includeAlternatives === false || isMinimalNativeTarget;

    if (alternatives && Array.isArray(alternatives) && !skipAlternatives) {
      for (let index = 0; index < alternatives.length; index++) {
        const alternative = alternatives[index];
        if (alternative && typeof alternative.text === "string") {
          const alternativeResult = validateSemantic(original, alternative.text);
          for (const error of alternativeResult.errors) {
            allErrors.push({
              ...error,
              field: `translations.${lang}.alternatives[${index}].${error.field ?? "text"}`,
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

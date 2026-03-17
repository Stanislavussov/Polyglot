export { validateSchema } from "./validators/schema.validator.js";
export { validateSemantic } from "./validators/semantic.validator.js";
export { validateLanguage, resolveToIso3 } from "./validators/language.validator.js";
export { validateExamples } from "./validators/example.validator.js";
export type { ExampleInput, ExpressionType } from "./validators/example.validator.js";
export type { ValidationResult, ValidationError, ValidateInput } from "./types.js";

import type { ZodSchema } from "zod";
import type { ValidationResult, ValidationError } from "./types.js";
import { validateSchema } from "./validators/schema.validator.js";
import { validateSemantic } from "./validators/semantic.validator.js";
import { validateLanguage } from "./validators/language.validator.js";
import { validateExamples } from "./validators/example.validator.js";
import type { ExpressionType } from "./validators/example.validator.js";

/**
 * Orchestrated validation: runs all validators in sequence.
 *
 * 1. Schema validation (Zod) — structural check
 * 2. Semantic validation — translation ≠ original, no hallucinations
 * 3. Language detection — via franc-min
 * 4. Example quality — examples contain the translated word
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
  const translations = parsed["translations"] as
    | Record<string, Record<string, unknown>>
    | undefined;

  if (!translations || typeof translations !== "object") {
    return { valid: allErrors.length === 0, errors: allErrors };
  }

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

    const translationText = langData["text"] as string | undefined;

    // Step 2: Semantic validation
    if (translationText) {
      const semanticResult = validateSemantic(original, translationText);
      for (const err of semanticResult.errors) {
        allErrors.push({
          ...err,
          field: `translations.${lang}.${err.field ?? "text"}`,
        });
      }
    }

    // Step 3: Language detection
    if (translationText) {
      const langResult = validateLanguage(translationText, lang);
      for (const err of langResult.errors) {
        allErrors.push({
          ...err,
          field: `translations.${lang}.${err.field ?? "text"}`,
        });
      }
    }

    // Step 4: Example validation
    const examples = langData["examples"] as
      | Array<{ context: string; target: string; native: string }>
      | undefined;
    const expressionType = langData["expressionType"] as
      | ExpressionType
      | undefined;

    if (examples && Array.isArray(examples) && translationText) {
      const exampleResult = validateExamples(examples, translationText, expressionType);
      for (const err of exampleResult.errors) {
        allErrors.push({
          ...err,
          field: `translations.${lang}.${err.field ?? "examples"}`,
        });
      }
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

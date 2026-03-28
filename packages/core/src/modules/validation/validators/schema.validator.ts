import type { ZodSchema } from "zod";
import type { ValidationResult } from "../types.js";

/**
 * Validates raw data against a Zod schema.
 * Returns field-level errors on failure.
 *
 * Pure function — no side effects.
 */
export function validateSchema(raw: unknown, schema: ZodSchema): ValidationResult {
  const result = schema.safeParse(raw);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.issues.map((issue) => ({
    rule: "schema",
    message: issue.message,
    field: issue.path.length > 0 ? issue.path.join(".") : undefined,
  }));

  return { valid: false, errors };
}

import type { ZodSchema } from "zod";

/** Detected input type — drives prompt, schema, and validation behavior */
export type InputType = "word" | "phrase" | "sentence";

/**
 * Output configuration that controls which validation steps run.
 *
 * Mirrors the caller's TranslationOutputConfig — when a field is disabled,
 * validation skips the corresponding check (no false failures on fields
 * the AI was never asked to produce).
 */
export interface ValidateOptions {
  /** When false, skip example validation. Default: true */
  includeExamples?: boolean;
  /** When false, skip alternatives semantic validation. Default: true */
  includeAlternatives?: boolean;
  /** When false, skip connotation warning validation. Default: true */
  includeConnotationWarning?: boolean;
  /** User's native language, used for native-language-only fields. */
  nativeLang?: string;
}

/** Result of a validation check */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** A single validation error */
export interface ValidationError {
  rule: string;
  message: string;
  field?: string;
}

/** Input for the orchestrated validate() function */
export interface ValidateInput {
  raw: unknown;
  schema: ZodSchema;
  original: string;
  expectedLangs: string[];
  inputType?: InputType;
}

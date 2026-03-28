import type { ZodSchema } from "zod";

/** Detected input type — drives prompt, schema, and validation behavior */
export type InputType = "word" | "phrase" | "sentence";

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

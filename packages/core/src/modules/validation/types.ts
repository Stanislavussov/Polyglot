/** Result of a validation check */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** A single validation error */
export interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

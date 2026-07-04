/** Base error class for the Polyglot application */
export class AppError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

/** Thrown when a requested resource is not found */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super("NOT_FOUND", id ? `${resource} with id "${id}" not found` : `${resource} not found`);
    this.name = "NotFoundError";
  }
}

/**
 * Thrown when an AI request exceeds its wall-clock time budget and is aborted.
 * Distinct from a generic failure so callers can surface a "taking longer"
 * message instead of a hard error, and so the underlying request is known to
 * have been cancelled (socket + provider slot freed) rather than left hanging.
 */
export class AITimeoutError extends AppError {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super("AI_TIMEOUT", `AI request timed out after ${timeoutMs}ms`);
    this.name = "AITimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when input validation fails */
export class ValidationFailedError extends AppError {
  public readonly details: string[];

  constructor(details: string[]) {
    super("VALIDATION_FAILED", `Validation failed: ${details.join(", ")}`);
    this.name = "ValidationFailedError";
    this.details = details;
  }
}

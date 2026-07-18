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

/**
 * Thrown when a per-model circuit breaker is open and the request is refused
 * WITHOUT calling the provider (bot self-healing Phase 3). The whole point of the
 * breaker is to stop hammering a provider that is already failing, so this is a
 * deliberate fast-fail — surfaced to the user as a graceful "temporarily
 * unavailable, try again shortly" notice, never a raw error. Distinct from
 * {@link AITimeoutError}: no call was attempted, so no socket/provider slot was
 * spent on this request.
 */
export class AICircuitOpenError extends AppError {
  public readonly model: string;

  constructor(model: string) {
    super("AI_CIRCUIT_OPEN", `AI circuit breaker is open for model "${model}"`);
    this.name = "AICircuitOpenError";
    this.model = model;
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

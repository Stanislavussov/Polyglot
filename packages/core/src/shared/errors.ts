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
    super(
      "NOT_FOUND",
      id ? `${resource} with id "${id}" not found` : `${resource} not found`,
    );
    this.name = "NotFoundError";
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

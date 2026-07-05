/**
 * A domain error carrying an HTTP status code. Thrown by the admin-api service
 * layer when a business invariant is violated (e.g. deleting the default AI
 * model). Fastify's error handler maps `statusCode` to the response status, so
 * handlers stay thin: validate → call service → shape response, with invariant
 * failures surfacing as clean 4xx responses.
 */
export class HttpError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

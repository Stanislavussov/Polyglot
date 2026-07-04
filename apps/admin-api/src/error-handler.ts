import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

/** A ZodError raised anywhere in the app, matched structurally so a second zod
 * module instance can't slip past a plain `instanceof` check. */
function isZodError(error: unknown): boolean {
  return error instanceof ZodError || (error as { name?: string })?.name === "ZodError";
}

/**
 * Global error handler for the admin API. Never leaks internals:
 * - a ZodError (query/body validation) becomes a clean 400 without exposing the
 *   schema shape or field paths;
 * - any 5xx is logged server-side and answered with a generic message;
 * - 4xx errors that already carry a safe statusCode (auth 401, rate-limit 429,
 *   ...) pass through with their own message.
 */
export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (isZodError(error)) {
      return reply.status(400).send({ error: "Invalid request parameters" });
    }
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, "Unhandled admin-api error");
      return reply.status(500).send({ error: "Internal Server Error" });
    }
    return reply.status(statusCode).send({ error: error.message });
  });
}

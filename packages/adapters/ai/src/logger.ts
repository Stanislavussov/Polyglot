/**
 * AI Request Logger
 *
 * Logs every AI request with: model, tokens, cost_usd, duration_ms, success.
 * Uses the shared pino logger from @polyglot/infra.
 */
import { logger as rootLogger } from "@polyglot/infra";
import type { AIRequestLog } from "./types.js";

const aiLogger = rootLogger.child({ module: "ai-adapter" });

/**
 * Log a completed AI request (success or failure).
 */
export function logRequest(log: AIRequestLog): void {
  const { model, tokens, cost_usd, duration_ms, success, userId, error } = log;

  const base = {
    model,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    cost_usd: Number(cost_usd.toFixed(6)),
    duration_ms,
    ...(userId !== undefined && { userId }),
  };

  if (success) {
    aiLogger.info(base, "AI request completed");
  } else {
    aiLogger.error({ ...base, error }, "AI request failed");
  }
}

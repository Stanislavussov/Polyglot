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
  const { model, tokens, cost_usd, duration_ms, success, error } = log;

  if (success) {
    aiLogger.info(
      {
        model,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cost_usd: Number(cost_usd.toFixed(6)),
        duration_ms,
      },
      "AI request completed",
    );
  } else {
    aiLogger.error(
      {
        model,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cost_usd: Number(cost_usd.toFixed(6)),
        duration_ms,
        error,
      },
      "AI request failed",
    );
  }
}

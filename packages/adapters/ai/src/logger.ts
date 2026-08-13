/**
 * AI Request Logger
 *
 * Logs every AI request with: model, tokens, cost_usd, duration_ms, success.
 * Uses core's Logger interface — injected at startup via setLogger().
 */

import type { Logger } from "@polyglot/core";
import { getLogger, logEvent } from "@polyglot/core";
import type { AIRequestLog, AIRequestMetricSink } from "./types.js";

let requestMetricSink: AIRequestMetricSink | null = null;

/**
 * Get the current logger (injected at composition root).
 */
function getAiLogger(): Logger {
  return getLogger();
}

export function setAIRequestMetricSink(sink: AIRequestMetricSink | null): void {
  requestMetricSink = sink;
}

function persistMetric(log: AIRequestLog, logger: Logger): void {
  if (!requestMetricSink) {
    return;
  }

  try {
    const result = requestMetricSink(log);
    if (result instanceof Promise) {
      result.catch((error: unknown) => {
        logger.warn({ error }, "AI request metric sink failed");
      });
    }
  } catch (error) {
    logger.warn({ error }, "AI request metric sink failed");
  }
}

/**
 * Log a completed AI request (success or failure).
 */
export function logRequest(log: AIRequestLog): void {
  const { model, requestKind, tokens, cost_usd, duration_ms, success, userId, error, budgetMs, timedOut } = log;
  const logger = getAiLogger();

  const base = {
    model,
    requestKind,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    cost_usd: Number(cost_usd.toFixed(6)),
    duration_ms,
    ...(userId !== undefined && { userId }),
    // The budget is logged next to the duration because the pair is what makes
    // an aborted call diagnosable — a duration alone cannot say whether the
    // provider was slow or the budget was set wrong (the "NaNms" outage class).
    ...(budgetMs !== undefined && { budgetMs }),
  };

  if (success) {
    logEvent("ai.request.completed", base);
  } else {
    logEvent("ai.request.failed", { ...base, error, timedOut: timedOut === true }, "error");
  }

  persistMetric(log, logger);
}

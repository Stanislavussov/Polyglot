import { logger } from "@polyglot/core";
import type { NextFunction } from "grammy";
import { telegramMessagesCounter, updateDeliveryLag, updateHandlingDuration } from "../metrics.js";
import type { BotContext } from "../types.js";

/** Updates slower than this (or delivered later than this) are logged as warnings. */
const SLOW_UPDATE_MS = 3000;

function classifyUpdate(ctx: BotContext): "message" | "callback" | "other" {
  if (ctx.callbackQuery) return "callback";
  if (ctx.message || ctx.editedMessage) return "message";
  return "other";
}

/**
 * Latency observability for every incoming update. Must be registered
 * before the session middleware so session round-trips are included in
 * the handling duration.
 *
 * Records:
 * - bot_update_handling_duration_seconds{update_type}
 * - bot_update_delivery_lag_seconds (messages only — Telegram does not
 *   timestamp callback taps)
 * - bot_telegram_messages_total{type}
 *
 * Logs a warning when handling or delivery exceeds SLOW_UPDATE_MS.
 */
export async function updateMetricsMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const updateType = classifyUpdate(ctx);
  telegramMessagesCounter.inc({ type: updateType });

  const messageDate = ctx.message?.date ?? ctx.editedMessage?.date;
  // Telegram dates have second precision; clock skew can make the lag negative.
  const deliveryLagMs = messageDate === undefined ? undefined : Math.max(0, Date.now() - messageDate * 1000);
  if (deliveryLagMs !== undefined) {
    updateDeliveryLag.observe(deliveryLagMs / 1000);
  }

  const startedAt = Date.now();
  try {
    await next();
  } finally {
    const durationMs = Date.now() - startedAt;
    updateHandlingDuration.observe({ update_type: updateType }, durationMs / 1000);

    if (durationMs >= SLOW_UPDATE_MS || (deliveryLagMs ?? 0) >= SLOW_UPDATE_MS) {
      logger.warn({ updateId: ctx.update?.update_id, updateType, durationMs, deliveryLagMs }, "Slow update handling");
    }
  }
}

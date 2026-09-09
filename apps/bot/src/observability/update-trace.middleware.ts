/**
 * Opens a trace for every incoming Telegram update and logs its lifecycle.
 *
 * Must be registered FIRST, ahead of update-metrics and session, so that every
 * later record — session reads, auth's DB lookup, handler events, AI calls,
 * outgoing Telegram replies — is stamped with this update's trace id and lands
 * in the same Loki query.
 */
import { errorFields, logEvent, newTraceId, runWithTrace, type TraceContext } from "@polyglot/core";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types.js";
import { handlerChain } from "./handler-log.js";
import { describeUpdate } from "./update-descriptor.js";

export async function updateTraceMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const descriptor = describeUpdate(ctx);
  const trace: TraceContext = {
    traceId: newTraceId(),
    source: "telegram.update",
    ...(ctx.update?.update_id !== undefined && { updateId: ctx.update.update_id }),
    ...(ctx.from?.id !== undefined && { telegramId: ctx.from.id }),
    ...(ctx.chat?.id !== undefined && { chatId: ctx.chat.id }),
  };

  // A short summary repeated on the closing record so latency and outcome can be
  // grouped in Grafana without joining back to `update.received`.
  const summary = {
    updateType: descriptor.updateType,
    ...(descriptor.command !== undefined && { command: descriptor.command }),
    ...(descriptor.callbackFamily !== undefined && { callbackFamily: descriptor.callbackFamily }),
    ...(descriptor.callbackData !== undefined && { callbackData: descriptor.callbackData }),
  };

  await runWithTrace(trace, async () => {
    const startedAt = Date.now();
    logEvent("update.received", descriptor);

    try {
      await next();
    } catch (error) {
      logEvent(
        "update.failed",
        { ...summary, durationMs: Date.now() - startedAt, handledBy: handlerChain(ctx), ...errorFields(error) },
        "error",
      );
      throw error;
    }

    const handledBy = handlerChain(ctx);
    logEvent("update.finished", {
      ...summary,
      durationMs: Date.now() - startedAt,
      handledBy,
      // An update no handler consumed is usually a dead button: a keyboard from
      // an older release whose prefix no longer routes anywhere. Surfacing it as
      // a warning turns a silent bot into an alertable signal.
      ...(handledBy.length === 0 && { outcome: "unhandled" }),
    });
    if (handledBy.length === 0) {
      logEvent("update.unhandled", descriptor, "warn");
    }
  });
}

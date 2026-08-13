import { errorFields, isSupported, logEvent, type SupportedLang, t } from "@polyglot/core";
import { type BotError, GrammyError, HttpError } from "grammy";
import { handlerChain } from "./observability/handler-log.js";
import { describeUpdate } from "./observability/update-descriptor.js";
import type { BotContext } from "./types.js";
import { isUserFacingTimeout } from "./utils/long-op.js";
import { replyTechnical } from "./utils/message-cleanup.js";

type BotErrorType = "telegram" | "network" | "application";

/** Distinguish Telegram API errors, network errors, and application bugs (T15/T14). */
function classify(error: unknown): BotErrorType {
  if (error instanceof GrammyError) return "telegram";
  if (error instanceof HttpError) return "network";
  return "application";
}

/** Best-effort reply language from Telegram's client locale — no DB lookup in the error path. */
function safeLang(ctx: BotContext): SupportedLang {
  const code = ctx.from?.language_code;
  return code && isSupported(code) ? (code as SupportedLang) : "en";
}

/**
 * Global bot error handler (Fable T15). It runs inside the grammy runner, so it
 * MUST NOT throw — an exception here becomes an unhandled rejection. It reads
 * ctx.session defensively (accessing it throws when the failure happened before
 * the session middleware ran) and sends a best-effort reply so a "Translating…"
 * indicator never hangs.
 */
export async function handleBotError(err: BotError<BotContext>): Promise<void> {
  const ctx = err.ctx;
  try {
    const cause = err.error;
    const errorType = classify(cause);

    // ctx.session throws if the error happened before the session middleware ran
    // (e.g. in update-metrics or sequentialize) — never let that crash the handler.
    let activeMode: string | undefined;
    try {
      activeMode = ctx.session?.activeMode;
    } catch {
      activeMode = undefined;
    }

    // The full update descriptor is repeated here even though `update.received`
    // already carries it: a crash report you can act on without first running a
    // second query is worth the duplicated fields.
    logEvent(
      "bot.error",
      {
        ...describeUpdate(ctx),
        ...errorFields(cause),
        errorType,
        ...(cause instanceof GrammyError && { errorCode: cause.error_code, telegramMethod: cause.method }),
        handledBy: handlerChain(ctx),
        sessionVersion: 1,
        activeMode,
      },
      "error",
    );

    // Stop any pending inline-button spinner.
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch(() => {});
    }

    // Best-effort user notice so no loader hangs. Skip when the failure was
    // itself a Telegram API error — the reply would just fail again. A
    // user-facing timeout / open circuit (Phase 3) surfaces the softer "try
    // again shortly" notice instead of the hard generic error.
    if (errorType !== "telegram") {
      const key = isUserFacingTimeout(cause) ? "loadingTimeout" : "genericError";
      await replyTechnical(ctx, t(key, safeLang(ctx))).catch(() => {});
    }
  } catch (handlerErr) {
    // The error handler itself must never throw.
    logEvent("bot.error_handler_failed", errorFields(handlerErr), "error");
  }
}

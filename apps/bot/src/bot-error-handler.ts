import { isSupported, logger, type SupportedLang, t } from "@polyglot/core";
import { type BotError, GrammyError, HttpError } from "grammy";
import type { BotContext } from "./types.js";
import { isUserFacingTimeout } from "./utils/long-op.js";

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

    logger.error(
      {
        error: cause instanceof Error ? cause.message : String(cause),
        errorType,
        errorCode: cause instanceof GrammyError ? cause.error_code : undefined,
        userId: ctx.from?.id,
        command: ctx.message?.text?.split(" ")[0] ?? "unknown",
        callbackFamily: ctx.callbackQuery?.data?.split(":")[0],
        sessionVersion: 1,
        activeMode,
      },
      "Bot error",
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
      await ctx.reply(t(key, safeLang(ctx))).catch(() => {});
    }
  } catch (handlerErr) {
    // The error handler itself must never throw.
    logger.error({ err: handlerErr }, "bot.catch handler failed");
  }
}

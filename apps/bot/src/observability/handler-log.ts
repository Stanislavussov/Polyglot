/**
 * Per-handler observability.
 *
 * `withHandlerLog` brackets a terminal handler (a command, an inline-button
 * callback, a reply-keyboard tap) with start/finish/failure events and records
 * it on the context, so the update-level summary can report which handler — if
 * any — actually consumed the update.
 *
 * Handlers are named from the function they wrap, so registering a new callback
 * route through the helpers in bot-factory gets it logged with no extra
 * argument to keep in sync.
 */
import { errorFields, logEvent } from "@polyglot/core";
import type { Context, MiddlewareFn, NextFunction } from "grammy";

/** Context fields this module owns. Kept structural so conversations fit too. */
interface HandlerTracked {
  handledBy?: string[];
}

/**
 * Record that `name` consumed this update. Terminal handlers are marked
 * automatically by {@link withHandlerLog}; pass-through middleware (the mode
 * router, the onboarding text gate) calls this on the branch that consumes, so
 * the summary names the branch rather than the middleware.
 */
export function markHandled(ctx: Context & HandlerTracked, name: string): void {
  ctx.handledBy = [...(ctx.handledBy ?? []), name];
}

/** Handlers that ran for this update, in order. */
export function handlerChain(ctx: Context & HandlerTracked): string[] {
  return ctx.handledBy ?? [];
}

/**
 * Wrap a handler so its execution is visible in the log.
 *
 * The start record is debug-level: at info the stream stays one line per
 * finished handler, and turning a container to `LOG_LEVEL=debug` reveals
 * handlers that were entered but never returned — the signature of a hang.
 *
 * Errors are rethrown untouched so the global `bot.catch` still owns the user
 * -facing failure path.
 */
export function withHandlerLog<C extends Context & HandlerTracked>(
  name: string,
  handler: MiddlewareFn<C>,
): MiddlewareFn<C> {
  return async (ctx: C, next: NextFunction): Promise<void> => {
    markHandled(ctx, name);
    const startedAt = Date.now();
    logEvent("handler.started", { handler: name }, "debug");
    try {
      await handler(ctx, next);
      logEvent("handler.finished", { handler: name, durationMs: Date.now() - startedAt });
    } catch (error) {
      logEvent("handler.failed", { handler: name, durationMs: Date.now() - startedAt, ...errorFields(error) }, "error");
      throw error;
    }
  };
}

/**
 * Derive a stable handler name. Function names survive the build (the bundle is
 * plain tsc output, not minified), so `handleDictView` is what appears in
 * Grafana; the pattern is the fallback for anonymous inline handlers.
 */
export function handlerName(handler: { readonly name: string }, fallback: string): string {
  return handler.name.length > 0 ? handler.name : fallback;
}

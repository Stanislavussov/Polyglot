/**
 * Product-event recording from the bot.
 *
 * The technical event stream (`logEvent` → Loki) already says what the process
 * did. This says what the *product* did — who reached the paywall, who bought,
 * which features get used — in a table the admin panel can aggregate.
 *
 * Every call here is deliberately fire-and-forget: analytics must never delay a
 * reply or turn a failed INSERT into a failed translation. A write that loses
 * its race with the process shutting down loses one row, which is the right
 * trade for never being on a user's critical path.
 */
import { errorFields, logEvent, type ProductEvent } from "@polyglot/core";
import type { MiddlewareFn, NextFunction } from "grammy";
import type { BotContext } from "../types.js";

/**
 * What recording needs from a context — narrow on purpose, so the conversation
 * flavour satisfies it as well as a plain update context.
 */
type TrackableContext = Pick<BotContext, "services"> & {
  user?: BotContext["user"];
};

/**
 * Record a product event. Never awaited, never throws.
 *
 * The plan is stamped from the user as they are *now*, because the funnel's
 * question is "what did a Free user do", and reading their plan months later
 * (after they upgraded) would answer a different one.
 */
export function trackProductEvent(ctx: TrackableContext, event: ProductEvent, context?: string): void {
  ctx.services.productEventRepository
    .record({ userId: ctx.user?.id, event, context, plan: ctx.user?.subscriptionPlan })
    .catch((err: unknown) => {
      logEvent("product_event.record_failed", { event, context, ...errorFields(err) }, "warn");
    });
}

/**
 * Wrap a command handler so running it records `command.used`.
 *
 * Registration in `bot-factory.ts` goes through `onCommand`, so this is the one
 * place that has to know about commands at all — a new command becomes visible
 * in the admin panel with no second edit, exactly as `withHandlerLog` makes it
 * visible in Grafana. The event fires on entry rather than on success: what is
 * being counted is that the user asked for the feature.
 */
export function withCommandTracking<C extends BotContext>(command: string, handler: MiddlewareFn<C>): MiddlewareFn<C> {
  return async (ctx: C, next: NextFunction): Promise<void> => {
    trackProductEvent(ctx, "command.used", command);
    await handler(ctx, next);
  };
}

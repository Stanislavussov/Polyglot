/**
 * Mode router middleware — routes plain text messages based on active mode.
 * This is the core of the persistent mode system.
 */
import type { NextFunction } from "grammy";
import type { BotContext } from "../types.js";
import { handleTranslateText } from "../scenes/helpers/translate-mode.helper.js";

/**
 * Routes plain text messages to the appropriate mode handler.
 * Commands (starting with /) are NOT processed here — they go through normal handlers.
 */
export async function modeRouterMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  // Only handle plain text messages (not commands)
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) {
    return next();
  }

  // Route based on active mode
  const mode = ctx.session.activeMode;

  switch (mode) {
    case "translate":
      await handleTranslateText(ctx, text);
      return; // Don't call next() — we handled it

    case "idle":
    default:
      // In idle mode, show a hint to pick a mode
      // For now, silently pass to next() (other handlers may process it)
      return next();
  }
}

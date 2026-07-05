import { type Middleware, type NextFunction } from "grammy";
import type { ConversationContext } from "../types.js";

/**
 * GrammY plugin for conversation context hydration.
 * Sets ctx.user inside conversations — same logic as authMiddleware.
 */
export function conversationAuthPlugin(): Middleware<ConversationContext> {
  return async (ctx: ConversationContext, next: NextFunction) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return next();

    // Resolve via the channel identity (Fable T24/A1) — same neutral path as authMiddleware.
    const userId = await ctx.services.identityRepository.resolveUserId("telegram", String(telegramId));
    const user = userId !== null ? await ctx.services.userRepository.findById(userId) : null;
    if (user) {
      ctx.user = user;
    }

    return next();
  };
}

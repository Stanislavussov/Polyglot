import { type Middleware, type NextFunction } from "grammy";
import { userRepository } from "@polyglot/adapter-db";
import type { ConversationContext } from "../types.js";

/**
 * GrammY plugin for conversation context hydration.
 * Sets ctx.user inside conversations — same logic as authMiddleware.
 */
export function conversationAuthPlugin(): Middleware<ConversationContext> {
  return async (ctx: ConversationContext, next: NextFunction) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return next();

    const user = await userRepository.findByTelegramId(telegramId);
    if (user) {
      ctx.user = user;
    }

    return next();
  };
}

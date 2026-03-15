import { userRepository } from "@polyglot/adapter-db";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types.js";
import { logger } from "@polyglot/infra";

/**
 * Auth middleware: resolves the Telegram user from the database.
 * Creates a new user record if one doesn't exist.
 * Attaches the user to `ctx.user`.
 */
export async function authMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    // No user info in this update (e.g. channel posts) — skip
    return next();
  }

  let user = await userRepository.findByTelegramId(telegramId);

  if (!user) {
    user = await userRepository.create({
      telegramId,
      username: ctx.from?.username ?? null,
    });
    logger.info({ telegramId, userId: user.id }, "New user created");
  }

  ctx.user = user;
  return next();
}

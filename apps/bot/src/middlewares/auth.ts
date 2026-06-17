import { userRepository } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";
import type { NextFunction } from "grammy";
import type { BotContext, UserMode } from "../types.js";

/** Modes that are valid for the session (matches UserMode type). */
const VALID_MODES = new Set<string>(["idle", "translate", "mentor"]);

/**
 * Auth middleware: resolves the Telegram user from the database.
 * Creates a new user record if one doesn't exist.
 * Attaches the user to `ctx.user`.
 * Hydrates `ctx.session.activeMode` from DB settings on first load.
 */
export async function authMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
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

  // Hydrate session activeMode from DB if user has settings.
  // This ensures the mode survives bot restarts.
  if (user.onboarded) {
    const settings = await userRepository.getSettings(user.id);
    if (settings?.activeMode) {
      const dbMode = settings.activeMode;
      ctx.session.activeMode = VALID_MODES.has(dbMode) ? (dbMode as UserMode) : "translate";
      logger.debug({ userId: user.id, activeMode: ctx.session.activeMode }, "Hydrated activeMode from DB");
    }

    // Fire-and-forget: update last interaction timestamp for notification inactivity detection.
    // Never blocks request processing — errors are logged but swallowed.
    userRepository.updateLastInteraction(user.id).catch((err) => {
      logger.error({ err, userId: user.id }, "Failed to update last interaction timestamp");
    });
  }

  return next();
}

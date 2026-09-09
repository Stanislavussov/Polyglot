import { enrichTrace, errorFields, logEvent } from "@polyglot/core";
import type { NextFunction } from "grammy";
import { type BotContext, USER_MODES, type UserMode } from "../types.js";
import { getRequestSettings } from "./request-settings.js";

/** Derived from the single source of truth so it can never drift from UserMode. */
const VALID_MODES = new Set<UserMode>(USER_MODES);

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

  // Resolve the neutral userId from the channel identity (Fable T24/A1). The bot
  // is the Telegram channel adapter, so it owns the telegram → userId mapping.
  const externalId = String(telegramId);
  const userId = await ctx.services.identityRepository.resolveUserId("telegram", externalId);
  let user = userId !== null ? await ctx.services.userRepository.findById(userId) : null;

  if (!user) {
    // Either a brand-new user or an existing telegram-only user without an
    // identity row yet. `create` is an idempotent get-or-create on telegram_id,
    // so both paths converge on the right user; linking then self-heals the
    // legacy user into an identity row on this first post-migration message.
    user = await ctx.services.userRepository.create({
      telegramId,
      username: ctx.from?.username ?? null,
    });
    await ctx.services.identityRepository.linkIdentity(user.id, "telegram", externalId);
    logEvent("user.identity_linked", { userId: user.id, onboarded: user.onboarded });
  }

  ctx.user = user;
  // Every record emitted from here on — DB reads, AI calls, outgoing replies —
  // carries the neutral userId without any call site passing it along.
  enrichTrace({ userId: user.id });

  // Hydrate session activeMode from DB if user has settings.
  // This ensures the mode survives bot restarts.
  if (user.onboarded) {
    const settings = await getRequestSettings(ctx, user.id);
    if (settings?.activeMode) {
      const dbMode = settings.activeMode;
      ctx.session.activeMode = VALID_MODES.has(dbMode as UserMode) ? (dbMode as UserMode) : "translate";
      logEvent("session.mode_hydrated", { activeMode: ctx.session.activeMode }, "debug");
    }

    // Fire-and-forget: update last interaction timestamp for notification inactivity detection.
    // Never blocks request processing — errors are logged but swallowed.
    ctx.services.userRepository.updateLastInteraction(user.id).catch((err: unknown) => {
      logEvent("user.last_interaction_failed", errorFields(err), "error");
    });
  }

  return next();
}

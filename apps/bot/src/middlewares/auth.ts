// Direct adapter import from a middleware (precedent: session-storage.ts:1): the persisted
// mode enum is owned by adapter-db, and deriving VALID_MODES from anything else lets it
// drift from the `active_mode` column this middleware hydrates from.
import { USER_MODES, type UserMode } from "@polyglot/adapter-db";
import { createAccounts, enrichTrace, errorFields, logEvent, TELEGRAM_CHANNEL } from "@polyglot/core";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types.js";
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

  // The one sign-in rule every channel uses (core `accounts`): the identity row
  // first, a legacy telegram_id row next, else a new account.
  const accounts = createAccounts({ identities: ctx.services.identityRepository, users: ctx.services.userRepository });
  const { user, created } = await accounts.signIn({
    channel: TELEGRAM_CHANNEL,
    externalId: String(telegramId),
    username: ctx.from?.username ?? null,
  });
  if (created) {
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

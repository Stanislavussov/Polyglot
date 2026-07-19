import type { UserLanguageSettings } from "@polyglot/core";
import type { BotContext } from "../types.js";

/**
 * Request-scoped memo for the user's language settings.
 *
 * A single Telegram update used to trigger up to three uncached `getSettings`
 * SELECTs (auth middleware → mode router → translate flow). grammY builds a
 * fresh `Context` per update, so memoising on `ctx` is scoped to exactly one
 * update and cannot outlive it.
 *
 * The memo additionally carries the `userId` it was resolved for and is ignored
 * on mismatch. That makes a cross-user leak impossible even if a context object
 * were ever reused or reconstructed: the worst case degrades to today's
 * behaviour (a fresh SELECT), never to another user's settings.
 *
 * NOTE: this deliberately wraps `userRepository.getSettings(userId)`. Never read
 * `ctx.user.settings` — it is always `undefined` in this bot.
 */
export function getRequestSettings(ctx: BotContext, userId: number): Promise<UserLanguageSettings | null> {
  const memo = ctx.settingsMemo;
  if (memo && memo.userId === userId) {
    return memo.promise;
  }
  // The promise (not the resolved value) is memoised so concurrent readers in the
  // same update share one in-flight query instead of racing two.
  const promise = ctx.services.userRepository.getSettings(userId);
  ctx.settingsMemo = { userId, promise };
  return promise;
}

/**
 * Drops the memo so the next {@link getRequestSettings} re-reads from the database.
 *
 * MUST be called after any write to the user's language settings that is followed
 * by a further read *within the same update*. Without it the later read returns
 * the value memoised before the write: the "add this language" flow writes
 * `updateLearningLangs` and then re-enters the translation pipeline in the same
 * update, which would otherwise still see the old `learningLangs` and could
 * re-offer the language the user just added.
 *
 * Uncached reads never needed this because they always saw the write; the memo is
 * what makes invalidation necessary.
 */
export function clearRequestSettings(ctx: BotContext): void {
  ctx.settingsMemo = undefined;
}

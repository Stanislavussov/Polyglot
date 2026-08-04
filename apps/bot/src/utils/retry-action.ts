/**
 * Retry affordance for user-facing timeouts.
 *
 * A long operation that dies on {@link isUserFacingTimeout} used to leave the
 * user with a dead-end notice ("this is taking longer than expected, please try
 * again") and no way to act on it other than retyping the input. This module
 * attaches a one-tap "🔄 Try again" button to that notice.
 *
 * Telegram caps `callback_data` at 64 bytes, which cannot carry the original
 * input, so the payload lives in the session keyed by the notice's message id —
 * the same per-message keying used by `translationMap` / `pendingOutOfSet`, so
 * two consecutive timeouts cannot cross-wire their inputs. Entries are one-shot
 * (read = delete) and capped, so a user who times out repeatedly cannot inflate
 * the session row.
 */
import { type SupportedLang, t } from "@polyglot/core";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { BotContext, SessionData } from "../types.js";

/** Callback data for the retry button. Flow-agnostic — the session entry says what to re-run. */
export const RETRY_CALLBACK = "retry";

/**
 * How many pending retry actions a session keeps. Retries are tapped within
 * seconds of the failure, so a handful is plenty; the cap only exists to stop an
 * unbounded map from inflating every subsequent session round-trip.
 */
export const MAX_RETRY_ACTIONS = 5;

/** What the retry button re-runs, and the input it re-runs with. */
export type RetryAction = NonNullable<SessionData["pendingRetries"]>[string];

/** Single-button keyboard carrying the retry affordance. */
export function retryKeyboard(lang: SupportedLang): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: t("retryButton", lang), callback_data: RETRY_CALLBACK }]] };
}

/**
 * Stores the action behind a retry button, evicting the least-recently-added
 * entries past {@link MAX_RETRY_ACTIONS}.
 *
 * Eviction is by insertion stamp rather than message id for the reason spelled
 * out in `setTranslationEntry`: a recreated chat (or another bot sharing this
 * session key) restarts message ids low, so the numerically smallest id can be
 * the entry that was just added.
 */
export function setRetryAction(session: SessionData, msgId: number, action: RetryAction): void {
  session.pendingRetries ??= {};
  const map = session.pendingRetries;

  let maxAddedAt = 0;
  for (const key of Object.keys(map)) {
    const addedAt = map[key].addedAt ?? 0;
    if (addedAt > maxAddedAt) maxAddedAt = addedAt;
  }
  map[String(msgId)] = { ...action, addedAt: maxAddedAt + 1 };

  const keys = Object.keys(map);
  if (keys.length <= MAX_RETRY_ACTIONS) return;

  keys.sort((a, b) => {
    const ra = map[a].addedAt ?? 0;
    const rb = map[b].addedAt ?? 0;
    return ra !== rb ? ra - rb : Number(a) - Number(b);
  });
  for (const key of keys.slice(0, keys.length - MAX_RETRY_ACTIONS)) {
    delete map[key];
  }
}

/**
 * Reads and consumes the action behind a retry button. One-shot on purpose: the
 * notice is deleted when the retry starts, and a second tap on a stale copy must
 * not launch the same paid AI call twice.
 */
export function takeRetryAction(session: SessionData, msgId: number): RetryAction | undefined {
  const map = session.pendingRetries;
  const entry = map?.[String(msgId)];
  if (!entry || !map) return undefined;
  delete map[String(msgId)];
  return entry;
}

/**
 * Sends a failure notice carrying a retry button and remembers what to re-run.
 *
 * The notice is deliberately NOT tracked as a technical message: the retry
 * handler deletes it itself, and a pending cleanup sweep must not remove the
 * button out from under the user.
 */
export async function replyWithRetry(
  ctx: BotContext,
  text: string,
  lang: SupportedLang,
  action: RetryAction,
): Promise<void> {
  const msg = await ctx.reply(text, { reply_markup: retryKeyboard(lang) });
  setRetryAction(ctx.session, msg.message_id, action);
}

/**
 * Re-encodes a parsed translation input back into a single line the text flow
 * can re-parse. ` :: ` is the freeform context separator accepted by
 * {@link parseTranslateInput}, so `word :: hint` round-trips to the same
 * `{ text, contextHint }` pair without depending on message entities (which a
 * callback update does not carry).
 */
export function encodeTranslateRetryText(word: string, contextHint?: string): string {
  return contextHint ? `${word} :: ${contextHint}` : word;
}

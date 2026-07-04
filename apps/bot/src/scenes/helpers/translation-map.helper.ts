import type { SessionData } from "../../types.js";

/**
 * Maximum number of translation cards retained in the per-user session
 * {@link SessionData.translationMap}. Older cards are evicted once this cap is
 * exceeded (LRU by Telegram message id — see {@link setTranslationEntry}).
 *
 * The session row is read and rewritten whole on every update (serialized by
 * grammy's sequentialize), so an unbounded map inflates every subsequent
 * request's storage round-trip. A heavy user translating for a long session
 * would otherwise accumulate thousands of cards. Capping keeps the row small;
 * the handful of most-recent cards are the only ones whose inline buttons a
 * user realistically taps. Accessing an evicted card falls through the existing
 * "session expired" guards on each callback handler.
 */
export const MAX_TRANSLATION_MAP_ENTRIES = 30;

type TranslationEntry = NonNullable<SessionData["translationMap"]>[string];

/**
 * Stores a translation card in the session, evicting the oldest cards once the
 * map exceeds {@link MAX_TRANSLATION_MAP_ENTRIES}.
 *
 * Telegram message ids increase monotonically within a chat, so the numerically
 * smallest keys are the oldest cards. Eviction sorts keys numerically and drops
 * from the low end — independent of JS object key-iteration order.
 */
export function setTranslationEntry(
  session: SessionData,
  msgId: number,
  entry: TranslationEntry,
  maxEntries: number = MAX_TRANSLATION_MAP_ENTRIES,
): void {
  session.translationMap ??= {};
  const map = session.translationMap;
  map[String(msgId)] = entry;

  const keys = Object.keys(map);
  if (keys.length <= maxEntries) {
    return;
  }

  keys.sort((a, b) => Number(a) - Number(b));
  for (const key of keys.slice(0, keys.length - maxEntries)) {
    delete map[key];
  }
}

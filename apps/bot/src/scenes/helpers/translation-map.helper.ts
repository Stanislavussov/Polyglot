import type { SessionData } from "../../types.js";
import { setEvictingEntry } from "../../utils/evicting-map.js";

/**
 * Maximum number of translation cards retained in the per-user session
 * {@link SessionData.translationMap}. Older cards are evicted once this cap is
 * exceeded (see {@link setTranslationEntry}).
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
 * Stores a translation card in the session, evicting the least-recently-added
 * cards once the map exceeds {@link MAX_TRANSLATION_MAP_ENTRIES} (see
 * `setEvictingEntry` for why eviction is by insertion stamp, not message id).
 */
export function setTranslationEntry(
  session: SessionData,
  msgId: number,
  entry: TranslationEntry,
  maxEntries: number = MAX_TRANSLATION_MAP_ENTRIES,
): void {
  session.translationMap ??= {};
  setEvictingEntry(session.translationMap, msgId, entry, maxEntries);
}

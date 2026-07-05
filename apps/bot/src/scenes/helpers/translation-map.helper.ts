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
 * Eviction is by **insertion recency**, not by Telegram message id. Message ids
 * are not a safe proxy for recency: a chat can be recreated — or a different bot
 * reusing this session key (the storage key is the user/chat id, shared across
 * bots on the same database) — restarts message ids at low numbers. When that
 * happens a brand-new card has a *smaller* id than stale entries left in the
 * map. Evicting the numerically smallest id would then drop the card that was
 * just added, in the same call, so its inline buttons immediately report
 * "session expired". Instead each entry is stamped with a monotonic
 * {@link TranslationEntry.addedAt} on insert and the least-recently-added
 * entries are evicted. The card just added always has the highest stamp, so it
 * can never be evicted here. Legacy entries without a stamp count as oldest and
 * are purged first, so a polluted map self-heals as new cards arrive.
 */
export function setTranslationEntry(
  session: SessionData,
  msgId: number,
  entry: TranslationEntry,
  maxEntries: number = MAX_TRANSLATION_MAP_ENTRIES,
): void {
  session.translationMap ??= {};
  const map = session.translationMap;

  let maxAddedAt = 0;
  for (const key of Object.keys(map)) {
    const addedAt = map[key].addedAt ?? 0;
    if (addedAt > maxAddedAt) maxAddedAt = addedAt;
  }
  map[String(msgId)] = { ...entry, addedAt: maxAddedAt + 1 };

  const keys = Object.keys(map);
  if (keys.length <= maxEntries) {
    return;
  }

  keys.sort((a, b) => {
    const ra = map[a].addedAt ?? 0;
    const rb = map[b].addedAt ?? 0;
    // Oldest insertion first; ties (e.g. legacy unstamped entries) break by
    // ascending id so eviction is deterministic.
    return ra !== rb ? ra - rb : Number(a) - Number(b);
  });
  for (const key of keys.slice(0, keys.length - maxEntries)) {
    delete map[key];
  }
}

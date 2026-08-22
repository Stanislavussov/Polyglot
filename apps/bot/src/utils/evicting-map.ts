/**
 * Insertion-stamped bounded map shared by the per-message session stores
 * (`translationMap`, `pendingRetries`, `pendingOutOfSet`). The session row is
 * read and rewritten whole on every update, so any unbounded map inflates every
 * subsequent request's storage round-trip — each store caps itself with this.
 *
 * Eviction is by **insertion recency**, not Telegram message id. Message ids
 * are not a safe proxy for recency: a recreated chat — or a different bot
 * reusing this session key (the storage key is the user/chat id, shared across
 * bots on the same database) — restarts message ids at low numbers, so the
 * numerically smallest id can be the entry that was just added. Each entry is
 * stamped with a monotonic `addedAt` on insert and the least-recently-added
 * entries are evicted; the entry just added always carries the highest stamp,
 * so it can never be evicted by its own insert. Legacy entries without a stamp
 * count as oldest and are purged first, so a polluted map self-heals as new
 * entries arrive.
 */
export function setEvictingEntry<T extends { addedAt?: number }>(
  map: Record<string, T>,
  msgId: number,
  entry: T,
  maxEntries: number,
): void {
  let maxAddedAt = 0;
  for (const key of Object.keys(map)) {
    const addedAt = map[key].addedAt ?? 0;
    if (addedAt > maxAddedAt) maxAddedAt = addedAt;
  }
  map[String(msgId)] = { ...entry, addedAt: maxAddedAt + 1 };

  const keys = Object.keys(map);
  if (keys.length <= maxEntries) return;

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

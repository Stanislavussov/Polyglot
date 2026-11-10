/**
 * Deterministic permutation of `items` for `seed`.
 *
 * Fisher-Yates over mulberry32 rather than `Math.random`, because the order has
 * to be *reproducible*: it is recomputed from scratch on every tick, and only
 * the de-dup memory is allowed to advance between sends. A re-rolled order
 * would re-serve words the user has already been shown.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let state = (seed | 0) + 0x6d2b79f5;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

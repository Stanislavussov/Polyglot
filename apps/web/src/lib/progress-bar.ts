/** The goal bar's dismissal: a timestamp under one key, so a hidden bar comes back by itself after a snooze. */
export const PROGRESS_BAR_KEY = "polyglot.progressBar.dismissed";
export const PROGRESS_BAR_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

type BarStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Garbage, a missing value or a timestamp from the future all mean "show" — a broken key must never hide the bar for good. */
export function isSnoozed(raw: string | null, now: number): boolean {
  if (raw === null || raw.trim() === "") return false;
  const dismissedAt = Number(raw);
  if (!Number.isFinite(dismissedAt) || dismissedAt > now) return false;
  return now - dismissedAt < PROGRESS_BAR_SNOOZE_MS;
}

// Storage throws in private windows and with blocked site data; the bar then simply shows.
export function readSnoozed(storage: BarStorage | null, now: number): boolean {
  try {
    return isSnoozed(storage?.getItem(PROGRESS_BAR_KEY) ?? null, now);
  } catch {
    return false;
  }
}

export function snooze(storage: BarStorage | null, now: number): void {
  try {
    storage?.setItem(PROGRESS_BAR_KEY, String(now));
  } catch {
    // The bar hides for this page view only.
  }
}

export function restore(storage: BarStorage | null): void {
  try {
    storage?.removeItem(PROGRESS_BAR_KEY);
  } catch {
    // Nothing stored that could keep it hidden.
  }
}

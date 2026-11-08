import { describe, expect, it } from "vitest";
import { isSnoozed, PROGRESS_BAR_KEY, PROGRESS_BAR_SNOOZE_MS, readSnoozed, restore, snooze } from "./progress-bar";

const NOW = 1_800_000_000_000;

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("isSnoozed", () => {
  it("hides the bar for three days after a dismissal, then shows it again", () => {
    expect(isSnoozed(String(NOW), NOW)).toBe(true);
    expect(isSnoozed(String(NOW - PROGRESS_BAR_SNOOZE_MS + 1), NOW)).toBe(true);
    expect(isSnoozed(String(NOW - PROGRESS_BAR_SNOOZE_MS), NOW)).toBe(false);
  });

  it("shows the bar for a missing, garbage or future value", () => {
    for (const raw of [null, "", "true", "NaN", String(NOW + 1000)]) expect(isSnoozed(raw, NOW)).toBe(false);
  });
});

describe("snooze and restore", () => {
  it("stores the dismissal under one key and brings the bar back on demand", () => {
    const storage = memoryStorage();

    snooze(storage, NOW);
    expect(storage.getItem(PROGRESS_BAR_KEY)).toBe(String(NOW));
    expect(readSnoozed(storage, NOW + 1000)).toBe(true);

    restore(storage);
    expect(readSnoozed(storage, NOW + 1000)).toBe(false);
  });

  it("shows the bar when storage is blocked", () => {
    expect(readSnoozed(throwing, NOW)).toBe(false);
    expect(() => snooze(throwing, NOW)).not.toThrow();
    expect(() => restore(throwing)).not.toThrow();
    expect(readSnoozed(null, NOW)).toBe(false);
  });
});

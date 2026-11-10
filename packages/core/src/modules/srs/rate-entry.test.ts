import { describe, expect, it, vi } from "vitest";
import { rateEntry } from "./rate-entry.js";

const NOW = new Date("2026-11-07T12:00:00Z");

function ports(saved: boolean, rows: Array<{ translationId: number; srsDueDate: Date | null }>) {
  return {
    vocabulary: {
      setDifficulty: vi.fn().mockResolvedValue(saved),
      findEntrySrsRows: vi
        .fn()
        .mockResolvedValue(rows.map((r) => ({ ...r, srsEaseFactor: 2.5, srsInterval: 1, srsReviewCount: 0 }))),
      updateSrsState: vi.fn().mockResolvedValue(undefined),
    },
    reviews: { logReview: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("rateEntry", () => {
  it("returns null and writes nothing when the entry is not the user's", async () => {
    const p = ports(false, []);
    expect(await rateEntry(p, 1, 9, "good", "web", {}, NOW)).toBeNull();
    expect(p.reviews.logReview).not.toHaveBeenCalled();
  });

  it("grades, reschedules every due language row and logs one review", async () => {
    const p = ports(true, [
      { translationId: 10, srsDueDate: NOW },
      { translationId: 11, srsDueDate: null },
    ]);
    const written = await rateEntry(p, 1, 9, "good", "web", {}, NOW);
    expect(p.vocabulary.setDifficulty).toHaveBeenCalledWith(9, 1, "normal");
    expect([...(written?.keys() ?? [])]).toEqual([10, 11]);
    expect(p.reviews.logReview).toHaveBeenCalledWith(1, 9, "web");
  });

  it("leaves a row that is practice-ahead untouched on a good rating", async () => {
    const p = ports(true, [{ translationId: 10, srsDueDate: new Date("2026-12-01T00:00:00Z") }]);
    const written = await rateEntry(p, 1, 9, "good", "web", {}, NOW);
    expect(written?.size).toBe(0);
    expect(p.vocabulary.updateSrsState).not.toHaveBeenCalled();
  });
});

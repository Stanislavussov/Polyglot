import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Configurable mock DB ────────────────────────────────────────

let insertCalls: Array<{ values: unknown }> = [];

const mockDb = {
  insert: vi.fn(() => ({
    values: vi.fn((vals: unknown) => {
      insertCalls.push({ values: vals });
      return Promise.resolve();
    }),
  })),
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const { wordReviewRepository } = await import("../repositories/word-review.repository.js");

beforeEach(() => {
  insertCalls = [];
  vi.clearAllMocks();
  // Re-apply default implementations after clearAllMocks
  mockDb.insert.mockImplementation(() => ({
    values: vi.fn((vals: unknown) => {
      insertCalls.push({ values: vals });
      return Promise.resolve();
    }),
  }));
});

// ── Tests ────────────────────────────────────────────────────────

describe("wordReviewRepository", () => {
  describe("logReview", () => {
    it("inserts a row into word_review_log", async () => {
      await wordReviewRepository.logReview(42, 10, "flashcard");

      expect(mockDb.insert).toHaveBeenCalledOnce();
      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0]!.values).toEqual({
        userId: 42,
        entryId: 10,
        sessionType: "flashcard",
      });
    });

    it("accepts different session types", async () => {
      await wordReviewRepository.logReview(1, 5, "notification");

      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0]!.values).toEqual({
        userId: 1,
        entryId: 5,
        sessionType: "notification",
      });
    });

    it("accepts quiz session type", async () => {
      await wordReviewRepository.logReview(1, 5, "quiz");

      expect(insertCalls[0]!.values).toEqual({
        userId: 1,
        entryId: 5,
        sessionType: "quiz",
      });
    });
  });
});

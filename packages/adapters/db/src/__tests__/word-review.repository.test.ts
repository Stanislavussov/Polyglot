import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Configurable mock DB ────────────────────────────────────────

let queryResults: unknown[] = [];
let queryIndex = 0;
let insertCalls: Array<{ values: unknown }> = [];

function nextResult(): unknown {
  return queryResults[queryIndex++] ?? [];
}

/**
 * Builds a chainable mock that returns the next result at any terminal position.
 * Supports: .from().where().groupBy(), .from().where().orderBy().limit()
 */
function chainable(): unknown {
  const self: Record<string, unknown> = {};
  const terminal = () => Promise.resolve(nextResult());

  self.from = vi.fn(() => self);
  self.where = vi.fn(() => self);
  self.orderBy = vi.fn(() => self);
  self.groupBy = vi.fn(() => self);
  self.limit = vi.fn(() => terminal());
  self.then = (resolve: (v: unknown) => void) => terminal().then(resolve);

  return self;
}

const mockDb = {
  select: vi.fn(() => chainable()),
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
  queryResults = [];
  queryIndex = 0;
  insertCalls = [];
  vi.clearAllMocks();
  // Re-apply default implementations after clearAllMocks
  mockDb.select.mockImplementation(() => chainable());
  mockDb.insert.mockImplementation(() => ({
    values: vi.fn((vals: unknown) => {
      insertCalls.push({ values: vals });
      return Promise.resolve();
    }),
  }));
});

// ── Helpers ──────────────────────────────────────────────────────

function makeReview(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    entryId: 10,
    userId: 42,
    sessionType: "flashcard",
    reviewedAt: new Date("2025-06-01T12:00:00Z"),
    ...overrides,
  };
}

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

  describe("getReviewCounts", () => {
    it("returns correct counts per entry ID", async () => {
      queryResults = [
        [
          { entryId: 10, reviewCount: 3 },
          { entryId: 20, reviewCount: 1 },
          { entryId: 30, reviewCount: 5 },
        ],
      ];

      const result = await wordReviewRepository.getReviewCounts(42);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(3);
      expect(result.get(10)).toBe(3);
      expect(result.get(20)).toBe(1);
      expect(result.get(30)).toBe(5);
    });

    it("returns empty Map for user with no reviews", async () => {
      queryResults = [[]];

      const result = await wordReviewRepository.getReviewCounts(42);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it("calls select with correct structure", async () => {
      queryResults = [[]];

      await wordReviewRepository.getReviewCounts(42);

      expect(mockDb.select).toHaveBeenCalledOnce();
    });
  });

  describe("getReviewsForWord", () => {
    it("returns reviews in descending order for an entry", async () => {
      const review1 = makeReview({ id: 1, reviewedAt: new Date("2025-06-01") });
      const review2 = makeReview({ id: 2, reviewedAt: new Date("2025-06-02") });
      queryResults = [[review2, review1]];

      const result = await wordReviewRepository.getReviewsForWord(10);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(review2);
      expect(result[1]).toEqual(review1);
    });

    it("returns empty array when entry has no reviews", async () => {
      queryResults = [[]];

      const result = await wordReviewRepository.getReviewsForWord(999);

      expect(result).toEqual([]);
    });

    it("respects limit parameter", async () => {
      const review = makeReview();
      queryResults = [[review]];

      const result = await wordReviewRepository.getReviewsForWord(10, 1);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(review);
    });

    it("returns all reviews when no limit is specified", async () => {
      const reviews = [makeReview({ id: 1 }), makeReview({ id: 2 }), makeReview({ id: 3 })];
      queryResults = [reviews];

      const result = await wordReviewRepository.getReviewsForWord(10);

      expect(result).toHaveLength(3);
    });
  });

  describe("getReviewsBySessionType", () => {
    it("returns reviews filtered by session type", async () => {
      const review = makeReview({ sessionType: "flashcard" });
      queryResults = [[review]];

      const result = await wordReviewRepository.getReviewsBySessionType(42, "flashcard");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(review);
    });

    it("returns empty array when no reviews match session type", async () => {
      queryResults = [[]];

      const result = await wordReviewRepository.getReviewsBySessionType(42, "quiz");

      expect(result).toEqual([]);
    });

    it("respects limit parameter", async () => {
      const review = makeReview();
      queryResults = [[review]];

      const result = await wordReviewRepository.getReviewsBySessionType(42, "flashcard", 5);

      expect(result).toHaveLength(1);
    });
  });
});

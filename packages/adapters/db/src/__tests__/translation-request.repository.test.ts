import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Configurable mock DB ────────────────────────────────────────

/** Each test pushes query results here; queries consume them in order. */
let queryResults: unknown[] = [];
let queryIndex = 0;
let insertCalls: Array<{ values: unknown }> = [];

function nextResult(): unknown {
  return queryResults[queryIndex++] ?? [];
}

/**
 * Builds a chainable mock that returns the next result at any terminal position.
 * Supports: .from().where().limit(), .from().where().orderBy().limit(),
 *           .from().leftJoin().where().orderBy().limit(),
 *           .from().innerJoin().where()
 */
function chainable(): unknown {
  const self: Record<string, unknown> = {};
  const terminal = () => Promise.resolve(nextResult());

  self.from = vi.fn(() => self);
  self.where = vi.fn(() => self);
  self.leftJoin = vi.fn(() => self);
  self.innerJoin = vi.fn(() => self);
  self.orderBy = vi.fn(() => self);
  self.limit = vi.fn(() => terminal());
  self.then = (resolve: (v: unknown) => void) => terminal().then(resolve);

  return self;
}

const mockDb = {
  select: vi.fn(() => chainable()),
  insert: vi.fn(() => ({
    values: vi.fn((vals: unknown) => {
      insertCalls.push({ values: vals });
      return {
        returning: vi.fn(() => Promise.resolve(nextResult())),
      };
    }),
  })),
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const { translationRequestRepository } = await import("../repositories/translation-request.repository.js");

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
      return {
        returning: vi.fn(() => Promise.resolve(nextResult())),
      };
    }),
  }));
});

// ── Tests ────────────────────────────────────────────────────────

describe("translationRequestRepository", () => {
  describe("logTranslationRequest", () => {
    it("logs a request with source and target languages resolved", async () => {
      queryResults = [
        // 1. select source lang id
        [{ id: 10 }],
        // 2. insert request → returning
        [{ id: 42 }],
        // 3. select target lang ids
        [{ id: 20 }, { id: 30 }],
        // 4. insert junction rows → returning (not used but consumed)
        [],
      ];

      const result = await translationRequestRepository.logTranslationRequest(1, "hello", "en", ["ru", "cs"]);

      expect(result).toBe(42);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
      expect(insertCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("handles null source language code", async () => {
      queryResults = [
        // No source lang select — skipped
        // 1. insert request → returning
        [{ id: 7 }],
        // 2. select target lang ids
        [{ id: 20 }],
        // 3. insert junction rows
        [],
      ];

      const result = await translationRequestRepository.logTranslationRequest(1, "bonjour", null, ["en"]);

      expect(result).toBe(7);
      // No select for source lang
      // 1 select for target langs + 2 inserts (request + junction)
    });

    it("handles empty target languages array", async () => {
      queryResults = [
        // 1. select source lang id
        [{ id: 10 }],
        // 2. insert request → returning
        [{ id: 5 }],
        // No target lang queries
      ];

      const result = await translationRequestRepository.logTranslationRequest(1, "test", "en", []);

      expect(result).toBe(5);
      // Only one insert (the request itself)
      expect(insertCalls).toHaveLength(1);
    });

    it("handles unknown source language code gracefully (resolves to null)", async () => {
      queryResults = [
        // 1. select source lang id — not found
        [],
        // 2. insert request → returning (sourceLangId will be null)
        [{ id: 3 }],
      ];

      const result = await translationRequestRepository.logTranslationRequest(1, "test", "xx", []);

      expect(result).toBe(3);
    });

    it("skips junction insert when no target languages resolve", async () => {
      queryResults = [
        // 1. insert request (no source lang)
        [{ id: 9 }],
        // 2. select target lang ids — none match
        [],
      ];

      const result = await translationRequestRepository.logTranslationRequest(1, "test", null, ["zz"]);

      expect(result).toBe(9);
      // Only one insert: the request
      expect(insertCalls).toHaveLength(1);
    });
  });

  describe("getUserRequestsInWindow", () => {
    it("returns count of requests since window start", async () => {
      queryResults = [[{ value: 5 }]];

      const result = await translationRequestRepository.getUserRequestsInWindow(1, new Date("2025-01-01"));

      expect(result).toBe(5);
      expect(mockDb.select).toHaveBeenCalledOnce();
    });

    it("returns 0 when no requests found", async () => {
      queryResults = [[{ value: 0 }]];

      const result = await translationRequestRepository.getUserRequestsInWindow(1, new Date("2025-01-01"));

      expect(result).toBe(0);
    });

    it("returns 0 when query returns empty array", async () => {
      queryResults = [[]];

      const result = await translationRequestRepository.getUserRequestsInWindow(1, new Date("2025-01-01"));

      expect(result).toBe(0);
    });
  });

  describe("getRecentRequests", () => {
    it("returns requests with resolved language codes", async () => {
      const now = new Date();

      queryResults = [
        // 1. select requests with source lang join
        [
          {
            id: 1,
            userId: 10,
            original: "hello",
            sourceLangCode: "en",
            createdAt: now,
          },
          {
            id: 2,
            userId: 10,
            original: "world",
            sourceLangCode: null,
            createdAt: now,
          },
        ],
        // 2. select target langs junction
        [
          { requestId: 1, code: "ru" },
          { requestId: 1, code: "cs" },
          { requestId: 2, code: "de" },
        ],
      ];

      const result = await translationRequestRepository.getRecentRequests(10, 5);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 1,
        userId: 10,
        original: "hello",
        sourceLangCode: "en",
        targetLangCodes: ["ru", "cs"],
        createdAt: now,
      });
      expect(result[1]).toEqual({
        id: 2,
        userId: 10,
        original: "world",
        sourceLangCode: null,
        targetLangCodes: ["de"],
        createdAt: now,
      });
    });

    it("returns empty array when user has no requests", async () => {
      queryResults = [
        // No requests
        [],
      ];

      const result = await translationRequestRepository.getRecentRequests(99, 10);

      expect(result).toEqual([]);
      // Should not make a second query for target langs
      expect(mockDb.select).toHaveBeenCalledOnce();
    });

    it("returns empty targetLangCodes when request has no targets", async () => {
      const now = new Date();

      queryResults = [
        // 1. requests
        [
          {
            id: 1,
            userId: 10,
            original: "test",
            sourceLangCode: "en",
            createdAt: now,
          },
        ],
        // 2. target langs — none
        [],
      ];

      const result = await translationRequestRepository.getRecentRequests(10, 5);

      expect(result).toHaveLength(1);
      expect(result[0]!.targetLangCodes).toEqual([]);
    });
  });
});

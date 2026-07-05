import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        // The per-user/per-day counter upsert (Fable T25/E5) resolves without a
        // returning(), so it never consumes a queued queryResult.
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      };
    }),
  })),
  // logTranslationRequest runs its writes in a transaction (E9/T18); the tx uses
  // the same query surface as the outer db so result ordering is unchanged.
  transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(mockDb)),
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
        onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      };
    }),
  }));
  mockDb.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockDb));
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
      // Two inserts: the request itself plus the per-user/per-day counter (T25).
      expect(insertCalls).toHaveLength(2);
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
      // Only one insert: the request. The counter upsert does not push to
      // insertCalls until it too runs (asserted below); here no targets means
      // request(1) + counter(1) = 2 inserts total.
      expect(insertCalls).toHaveLength(2);
    });
  });

  // The compact per-user/per-day counter (Fable T25/E5) is the pre-aggregated
  // source the admin dashboard reads instead of GROUP-BY-ing the ever-growing
  // ledger. It is bumped inside the same request-logging transaction.
  describe("logTranslationRequest — daily request counter (T25)", () => {
    /** The counter upsert is the insert whose values carry a `requestCount`. */
    function counterInsert(): { userId: number; day: string; requestCount: number } | undefined {
      const call = insertCalls.find(
        (c) => typeof c.values === "object" && c.values !== null && "requestCount" in c.values,
      );
      return call?.values as { userId: number; day: string; requestCount: number } | undefined;
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("upserts the counter with requestCount 1 for the logging user", async () => {
      queryResults = [
        [{ id: 10 }], // source lang id
        [{ id: 42 }], // insert request → returning
        [{ id: 20 }], // target lang ids
        [], // junction insert returning
      ];

      await translationRequestRepository.logTranslationRequest(7, "hello", "en", ["ru"]);

      const counter = counterInsert();
      expect(counter).toBeDefined();
      expect(counter?.userId).toBe(7);
      expect(counter?.requestCount).toBe(1);
    });

    it("buckets the counter day in UTC regardless of process timezone", async () => {
      // 23:30 UTC on 2025-06-15: in Asia/Tokyo (+9) the local wall-clock date is
      // already 2025-06-16, and in America/New_York (-4) it is still 2025-06-15.
      // A UTC bucket must resolve to 2025-06-15 under every process timezone.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-06-15T23:30:00.000Z"));

      const originalTz = process.env.TZ;
      try {
        for (const tz of ["UTC", "Asia/Tokyo", "America/New_York"]) {
          process.env.TZ = tz;
          insertCalls = [];
          queryIndex = 0;
          queryResults = [
            [{ id: 3 }], // insert request → returning (no source lang)
          ];

          await translationRequestRepository.logTranslationRequest(1, "tz-test", null, []);

          expect(counterInsert()?.day).toBe("2025-06-15");
        }
      } finally {
        if (originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = originalTz;
      }
    });
  });

  describe("getUserCreditsInWindow", () => {
    it("returns credit sum since window start", async () => {
      queryResults = [[{ value: 5 }]];

      const result = await translationRequestRepository.getUserCreditsInWindow(1, new Date("2025-01-01"));

      expect(result).toBe(5);
      expect(mockDb.select).toHaveBeenCalledOnce();
    });

    it("returns 0 when no requests found", async () => {
      queryResults = [[{ value: 0 }]];

      const result = await translationRequestRepository.getUserCreditsInWindow(1, new Date("2025-01-01"));

      expect(result).toBe(0);
    });

    it("returns 0 when query returns empty array", async () => {
      queryResults = [[]];

      const result = await translationRequestRepository.getUserCreditsInWindow(1, new Date("2025-01-01"));

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
            creditCost: 3,
            createdAt: now,
          },
          {
            id: 2,
            userId: 10,
            original: "world",
            sourceLangCode: null,
            creditCost: 2,
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
        creditCost: 3,
        createdAt: now,
      });
      expect(result[1]).toEqual({
        id: 2,
        userId: 10,
        original: "world",
        sourceLangCode: null,
        targetLangCodes: ["de"],
        creditCost: 2,
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
            creditCost: 1,
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

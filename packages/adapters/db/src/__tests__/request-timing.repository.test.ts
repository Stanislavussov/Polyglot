import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Configurable mock DB ────────────────────────────────────────

let queryResults: unknown[] = [];
let queryIndex = 0;
let insertCalls: Array<{ values: unknown }> = [];

function nextResult(): unknown {
  return queryResults[queryIndex++] ?? [];
}

function chainable(): unknown {
  const self: Record<string, unknown> = {};
  const terminal = () => Promise.resolve(nextResult());

  self.from = vi.fn(() => self);
  self.where = vi.fn(() => self);
  self.groupBy = vi.fn(() => self);
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
      return Promise.resolve();
    }),
  })),
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const { requestTimingRepository } = await import("../repositories/request-timing.repository.js");

beforeEach(() => {
  queryResults = [];
  queryIndex = 0;
  insertCalls = [];
  vi.clearAllMocks();
  mockDb.select.mockImplementation(() => chainable());
  mockDb.insert.mockImplementation(() => ({
    values: vi.fn((vals: unknown) => {
      insertCalls.push({ values: vals });
      return Promise.resolve();
    }),
  }));
});

// ── Tests ────────────────────────────────────────────────────────

describe("requestTimingRepository", () => {
  describe("record", () => {
    it("inserts a timing record with all fields", async () => {
      await requestTimingRepository.record({
        userId: 1,
        requestType: "translate",
        preflightMs: 50,
        dbLookupMs: 30,
        aiRequestMs: 1200,
        totalMs: 1300,
        modelId: "openai/gpt-4o",
        sourceLang: "en",
        targetLangs: ["ru", "cs"],
        inputType: "word",
        success: true,
      });

      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0]!.values).toEqual({
        userId: 1,
        requestType: "translate",
        preflightMs: 50,
        dbLookupMs: 30,
        aiRequestMs: 1200,
        totalMs: 1300,
        modelId: "openai/gpt-4o",
        sourceLang: "en",
        targetLangs: ["ru", "cs"],
        inputType: "word",
        success: true,
        error: undefined,
      });
    });

    it("inserts a failed timing record with error message", async () => {
      await requestTimingRepository.record({
        userId: 2,
        requestType: "translate",
        preflightMs: 10,
        dbLookupMs: 0,
        aiRequestMs: 0,
        totalMs: 100,
        success: false,
        error: "AI service unavailable",
      });

      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0]!.values).toMatchObject({
        success: false,
        error: "AI service unavailable",
      });
    });

    it("handles optional fields as undefined", async () => {
      await requestTimingRepository.record({
        requestType: "translate",
        preflightMs: 5,
        dbLookupMs: 2,
        aiRequestMs: 500,
        totalMs: 510,
        success: true,
      });

      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0]!.values).toMatchObject({
        userId: undefined,
        modelId: undefined,
        sourceLang: undefined,
        targetLangs: undefined,
        inputType: undefined,
        error: undefined,
      });
    });
  });

  describe("getSegmentSummaryByDay", () => {
    it("returns aggregated timing data grouped by day", async () => {
      queryResults = [
        [
          {
            date: "2025-01-15",
            requestCount: 100,
            avgPreflightMs: 45,
            avgDbLookupMs: 25,
            avgAiRequestMs: 1100,
            avgTotalMs: 1200,
            p95TotalMs: 2500,
            successRate: 0.95,
          },
          {
            date: "2025-01-14",
            requestCount: 80,
            avgPreflightMs: 50,
            avgDbLookupMs: 30,
            avgAiRequestMs: 1200,
            avgTotalMs: 1300,
            p95TotalMs: 2800,
            successRate: 0.92,
          },
        ],
      ];

      const result = await requestTimingRepository.getSegmentSummaryByDay(7);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        date: "2025-01-15",
        requestCount: 100,
        avgPreflightMs: 45,
        avgDbLookupMs: 25,
        avgAiRequestMs: 1100,
        avgTotalMs: 1200,
        p95TotalMs: 2500,
        successRate: 0.95,
      });
      expect(mockDb.select).toHaveBeenCalledOnce();
    });

    it("returns empty array when no data exists", async () => {
      queryResults = [[]];

      const result = await requestTimingRepository.getSegmentSummaryByDay(7);

      expect(result).toEqual([]);
    });

    it("uses default 7 days when not specified", async () => {
      queryResults = [[]];

      await requestTimingRepository.getSegmentSummaryByDay();

      expect(mockDb.select).toHaveBeenCalledOnce();
    });
  });

  describe("getSegmentSummaryByModel", () => {
    it("returns aggregated timing data grouped by model", async () => {
      queryResults = [
        [
          {
            modelId: "openai/gpt-4o",
            requestCount: 50,
            avgPreflightMs: 40,
            avgDbLookupMs: 20,
            avgAiRequestMs: 1000,
            avgTotalMs: 1100,
            successRate: 0.98,
          },
          {
            modelId: "anthropic/claude-3-opus",
            requestCount: 30,
            avgPreflightMs: 45,
            avgDbLookupMs: 25,
            avgAiRequestMs: 1500,
            avgTotalMs: 1600,
            successRate: 0.96,
          },
        ],
      ];

      const result = await requestTimingRepository.getSegmentSummaryByModel(7, 12);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        modelId: "openai/gpt-4o",
        requestCount: 50,
        avgPreflightMs: 40,
        avgDbLookupMs: 20,
        avgAiRequestMs: 1000,
        avgTotalMs: 1100,
        successRate: 0.98,
      });
    });

    it("returns 'unknown' for null modelId", async () => {
      queryResults = [
        [
          {
            modelId: null,
            requestCount: 5,
            avgPreflightMs: 10,
            avgDbLookupMs: 5,
            avgAiRequestMs: 200,
            avgTotalMs: 220,
            successRate: 0.8,
          },
        ],
      ];

      const result = await requestTimingRepository.getSegmentSummaryByModel(7, 12);

      expect(result).toHaveLength(1);
      expect(result[0]!.modelId).toBe("unknown");
    });

    it("returns empty array when no data exists", async () => {
      queryResults = [[]];

      const result = await requestTimingRepository.getSegmentSummaryByModel(7, 12);

      expect(result).toEqual([]);
    });

    it("uses default parameters when not specified", async () => {
      queryResults = [[]];

      await requestTimingRepository.getSegmentSummaryByModel();

      expect(mockDb.select).toHaveBeenCalledOnce();
    });
  });
});

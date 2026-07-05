import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Chainable mock DB — resolves the next queued result at any terminal ────────

let queryResults: unknown[] = [];
let queryIndex = 0;

function nextResult(): unknown {
  return queryResults[queryIndex++] ?? [];
}

function chainable(): unknown {
  const self: Record<string, unknown> = {};
  const terminal = () => Promise.resolve(nextResult());
  self.from = vi.fn(() => self);
  self.innerJoin = vi.fn(() => self);
  self.where = vi.fn(() => self);
  self.orderBy = vi.fn(() => self);
  self.then = (resolve: (v: unknown) => void) => terminal().then(resolve);
  return self;
}

const mockDb = {
  select: vi.fn(() => chainable()),
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const { userRequestCountRepository } = await import("../repositories/user-request-count.repository.js");

beforeEach(() => {
  queryResults = [];
  queryIndex = 0;
  vi.clearAllMocks();
  mockDb.select.mockImplementation(() => chainable());
});

describe("userRequestCountRepository.getUserRequestCountsByDay", () => {
  it("returns per-user/per-day counts sourced from the compact counter (T25)", async () => {
    // Rows come straight from user_daily_request_counts joined to users — no
    // GROUP BY over the translation_requests ledger.
    queryResults = [
      [
        {
          userId: 1,
          username: "alice",
          telegramId: 111,
          subscriptionPlan: "free",
          day: "2025-06-15",
          count: 12,
        },
        {
          userId: 2,
          username: null,
          telegramId: 222,
          subscriptionPlan: "plus",
          day: "2025-06-14",
          count: 3,
        },
      ],
    ];

    const rows = await userRequestCountRepository.getUserRequestCountsByDay(30);

    expect(mockDb.select).toHaveBeenCalledOnce();
    expect(rows).toEqual([
      { userId: 1, username: "alice", telegramId: 111, subscriptionPlan: "free", day: "2025-06-15", count: 12 },
      { userId: 2, username: null, telegramId: 222, subscriptionPlan: "plus", day: "2025-06-14", count: 3 },
    ]);
  });

  it("returns an empty list when the counter has no rows in range", async () => {
    queryResults = [[]];
    const rows = await userRequestCountRepository.getUserRequestCountsByDay();
    expect(rows).toEqual([]);
  });
});

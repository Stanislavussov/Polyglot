import type { TranslateOutput } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Drizzle query builder ──────────────────────────────────
// getDb() returns a chainable builder that records what the repository asked
// for, so the tests can assert on the shape of the write rather than on SQL.

const mockRows: unknown[] = [];
/** Answers the `count(*)` query behind `list`. */
let mockTotal = 0;
/** Answers the whole-table aggregate behind `counts`. */
let mockCounts = { cached: 0, active: 0 };
let lastInsertValues: Record<string, unknown> | null = null;
let lastConflictConfig: { set: Record<string, unknown> } | null = null;

/**
 * A chainable, awaitable stand-in for a Drizzle query. Every builder step
 * returns the same thing, so the repository can compose them in any order and
 * the awaited value is decided solely by which columns it selected.
 */
function queryChain(resolve: () => unknown[]) {
  const chain = {
    then: (onFulfilled?: ((value: unknown[]) => unknown) | null, onRejected?: ((reason: unknown) => unknown) | null) =>
      Promise.resolve().then(resolve).then(onFulfilled, onRejected),
    where: vi.fn(() => queryChain(resolve)),
    orderBy: vi.fn(() => queryChain(resolve)),
    limit: vi.fn(() => queryChain(resolve)),
    offset: vi.fn(() => queryChain(resolve)),
    $dynamic: vi.fn(() => queryChain(resolve)),
  };
  return chain;
}

function resultFor(fields?: Record<string, unknown>): unknown[] {
  if (fields && "cached" in fields) return [mockCounts];
  if (fields && "count" in fields) return [{ count: mockTotal }];
  return mockRows;
}

const selectFn = vi.fn((fields?: Record<string, unknown>) => ({
  from: vi.fn(() => queryChain(() => resultFor(fields))),
}));

const onConflictDoUpdateFn = vi.fn((config: { set: Record<string, unknown> }) => {
  lastConflictConfig = config;
  return Promise.resolve();
});

const insertValuesFn = vi.fn((values: Record<string, unknown>) => {
  lastInsertValues = values;
  return { onConflictDoUpdate: onConflictDoUpdateFn };
});

const insertFn = vi.fn(() => ({ values: insertValuesFn }));

const mockDb = {
  select: selectFn,
  insert: insertFn,
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

// Import after the mock is set up
const { onboardingDemoCardRepository } = await import("../repositories/onboarding-demo-card.repository.js");

const payload = { original: "doch", sourceLang: "de", nativeSynonyms: [], translations: {} } satisfies TranslateOutput;

beforeEach(() => {
  mockRows.length = 0;
  mockTotal = 0;
  mockCounts = { cached: 0, active: 0 };
  lastInsertValues = null;
  lastConflictConfig = null;
  vi.clearAllMocks();
});

describe("onboardingDemoCardRepository", () => {
  it("returns the cards a pair has, in the order the query produced", async () => {
    const rows = [
      { id: 2, sourceLang: "de", nativeLang: "ru", headword: "doch", sortOrder: 0 },
      { id: 1, sourceLang: "de", nativeLang: "ru", headword: "Backpfeifengesicht", sortOrder: 1 },
    ];
    mockRows.push(...rows);

    await expect(onboardingDemoCardRepository.findActive("de", "ru")).resolves.toEqual(rows);
  });

  it("returns an empty list when a pair has no servable cards", async () => {
    await expect(onboardingDemoCardRepository.findActive("kk", "cs")).resolves.toEqual([]);
  });

  it("returns null from findOne when nothing servable matches", async () => {
    await expect(onboardingDemoCardRepository.findOne("de", "ru", "doch")).resolves.toBeNull();
  });

  it("reports a cached triple regardless of its review state", async () => {
    await expect(onboardingDemoCardRepository.hasCached("de", "ru", "doch")).resolves.toBe(false);

    mockRows.push({ id: 7 });
    await expect(onboardingDemoCardRepository.hasCached("de", "ru", "doch")).resolves.toBe(true);
  });

  it("inserts a new card unreviewed — the DB default decides, the write never does", async () => {
    await onboardingDemoCardRepository.upsert({
      sourceLang: "de",
      nativeLang: "ru",
      headword: "doch",
      payload,
      sortOrder: 2,
    });

    expect(lastInsertValues).toEqual({
      sourceLang: "de",
      nativeLang: "ru",
      headword: "doch",
      payload,
      sortOrder: 2,
    });
    expect(lastInsertValues).not.toHaveProperty("isActive");
  });

  it("defaults an omitted sort order to 0", async () => {
    await onboardingDemoCardRepository.upsert({ sourceLang: "de", nativeLang: "ru", headword: "doch", payload });

    expect(lastInsertValues?.sortOrder).toBe(0);
  });

  it("reports how much of the cache is servable", async () => {
    mockCounts = { cached: 42, active: 3 };

    await expect(onboardingDemoCardRepository.counts()).resolves.toEqual({ cached: 42, active: 3 });
  });

  it("reports zeroes for an empty cache", async () => {
    await expect(onboardingDemoCardRepository.counts()).resolves.toEqual({ cached: 0, active: 0 });
  });

  it("lists cards for review with their pagination and whole-table review state", async () => {
    const rows = [
      { id: 1, sourceLang: "de", nativeLang: "ru", headword: "doch", isActive: false },
      { id: 2, sourceLang: "de", nativeLang: "ru", headword: "Backpfeifengesicht", isActive: true },
    ];
    mockRows.push(...rows);
    mockTotal = 2;
    mockCounts = { cached: 42, active: 1 };

    await expect(onboardingDemoCardRepository.list({ page: 2, limit: 20 })).resolves.toEqual({
      cards: rows,
      total: 2,
      page: 2,
      limit: 20,
      counts: { cached: 42, active: 1 },
    });
  });

  it("returns unreviewed rows from the review listing — unlike the serving path", async () => {
    mockRows.push({ id: 1, headword: "doch", isActive: false });
    mockTotal = 1;

    const result = await onboardingDemoCardRepository.list({ page: 1, limit: 20, isActive: false });

    expect(result.cards).toEqual([{ id: 1, headword: "doch", isActive: false }]);
  });

  it("refreshes only the payload and ordering on conflict, never the review flag", async () => {
    await onboardingDemoCardRepository.upsert({
      sourceLang: "de",
      nativeLang: "ru",
      headword: "doch",
      payload,
      sortOrder: 1,
    });

    expect(lastConflictConfig?.set).toEqual({ payload, sortOrder: 1 });
  });
});

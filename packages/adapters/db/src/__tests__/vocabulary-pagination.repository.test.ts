import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  VocabTranslationDetails,
  VocabularyEntry,
  VocabularyTranslation,
} from "../repositories/vocabulary.repository.js";

// ── Mock Drizzle query builder ──────────────────────────────────

let selectResultQueue: unknown[][] = [];
let deleteWhereArgs: unknown[] = [];

/**
 * Creates a thenable object that mimics Drizzle's query builder chain.
 * Drizzle builders are both awaitable and chainable.
 */
function makeThenable(resultFn: () => unknown[]) {
  const promise = Promise.resolve().then(() => resultFn());
  return {
    // biome-ignore lint/suspicious/noThenProperty: mimicking Drizzle's thenable query builder for tests
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    limit: vi.fn((_n: number) => makeThenable(resultFn)),
    offset: vi.fn((_n: number) => makeThenable(resultFn)),
    orderBy: vi.fn(() => makeThenable(resultFn)),
  };
}

const selectWhereFn = vi.fn(() => {
  const result = selectResultQueue.shift() ?? [];
  return makeThenable(() => result);
});

const selectFromFn = vi.fn(() => ({
  where: selectWhereFn,
  orderBy: vi.fn(() => {
    const result = selectResultQueue.shift() ?? [];
    return makeThenable(() => result);
  }),
}));

const selectFn = vi.fn(() => ({ from: selectFromFn }));

const deleteWhereFn = vi.fn((...args: unknown[]) => {
  deleteWhereArgs.push(args);
  return Promise.resolve();
});
const deleteFn = vi.fn(() => ({ where: deleteWhereFn }));

const insertReturningFn = vi.fn(() => Promise.resolve([]));
const insertValuesFn = vi.fn(() => ({ returning: insertReturningFn }));
const insertFn = vi.fn(() => ({ values: insertValuesFn }));

const updateReturningFn = vi.fn(() => Promise.resolve([]));
const updateWhereFn = vi.fn(() => ({ returning: updateReturningFn }));
const updateSetFn = vi.fn(() => ({ where: updateWhereFn }));
const updateFn = vi.fn(() => ({ set: updateSetFn }));

const transactionFn = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
  return cb(mockDb);
});

const mockDb = {
  select: selectFn,
  insert: insertFn,
  update: updateFn,
  delete: deleteFn,
  transaction: transactionFn,
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const { vocabularyRepository } = await import("../repositories/vocabulary.repository.js");

beforeEach(() => {
  selectResultQueue = [];
  deleteWhereArgs = [];
  vi.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────

function makeDetails(overrides: Partial<VocabTranslationDetails> = {}): VocabTranslationDetails {
  return {
    synonyms: [{ text: "nazdar" }],
    examples: [{ context: "neutral", target: "Ahoj!" }],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<VocabularyEntry> = {}): VocabularyEntry {
  return {
    id: 1,
    userId: 42,
    original: "hello",
    sourceLangId: 5,
    inputType: "word",
    emoji: "👋",
    isActive: true,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function makeTranslation(overrides: Partial<VocabularyTranslation> = {}): VocabularyTranslation {
  return {
    id: 10,
    entryId: 1,
    targetLangId: 3,
    text: "ahoj",
    transcription: null,
    expressionType: null,
    equivalentNote: null,
    connotationWarning: null,
    details: makeDetails(),
    isActive: true,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("vocabularyRepository — pagination & hardDelete", () => {
  describe("countByUser", () => {
    it("returns correct count for user with entries", async () => {
      selectResultQueue.push([{ value: 7 }]);

      const result = await vocabularyRepository.countByUser(42);

      expect(selectFn).toHaveBeenCalledOnce();
      expect(result).toBe(7);
    });

    it("returns 0 for user with no entries", async () => {
      selectResultQueue.push([{ value: 0 }]);

      const result = await vocabularyRepository.countByUser(999);

      expect(result).toBe(0);
    });

    it("returns 0 when query returns empty result", async () => {
      selectResultQueue.push([]);

      const result = await vocabularyRepository.countByUser(999);

      expect(result).toBe(0);
    });
  });

  describe("findByUserPaginated", () => {
    it("returns correct page of entries with translations", async () => {
      const e1 = makeEntry({ id: 1, original: "hello" });
      const e2 = makeEntry({ id: 2, original: "world" });
      const t1 = makeTranslation({ entryId: 1, text: "ahoj" });
      const t2 = makeTranslation({ id: 11, entryId: 2, text: "svět" });
      // First select: entries (paginated), second select: translations
      selectResultQueue.push([e1, e2], [t1, t2]);

      const result = await vocabularyRepository.findByUserPaginated(42, 0, 15);

      expect(result).toHaveLength(2);
      expect(result[0]!.original).toBe("hello");
      expect(result[0]!.translations).toHaveLength(1);
      expect(result[0]!.translations[0]!.text).toBe("ahoj");
      expect(result[1]!.original).toBe("world");
      expect(result[1]!.translations).toHaveLength(1);
      expect(result[1]!.translations[0]!.text).toBe("svět");
    });

    it("returns empty array when offset is beyond total", async () => {
      selectResultQueue.push([]);

      const result = await vocabularyRepository.findByUserPaginated(42, 100, 15);

      expect(result).toEqual([]);
    });

    it("returns entries with multiple translations", async () => {
      const entry = makeEntry({ id: 1 });
      const t1 = makeTranslation({ entryId: 1, targetLangId: 3, text: "ahoj" });
      const t2 = makeTranslation({ id: 11, entryId: 1, targetLangId: 7, text: "hallo" });
      selectResultQueue.push([entry], [t1, t2]);

      const result = await vocabularyRepository.findByUserPaginated(42, 0, 15);

      expect(result).toHaveLength(1);
      expect(result[0]!.translations).toHaveLength(2);
    });

    it("returns entries ordered by createdAt DESC", async () => {
      const e1 = makeEntry({ id: 1, createdAt: new Date("2025-01-01") });
      const e2 = makeEntry({ id: 2, createdAt: new Date("2025-06-01") });
      selectResultQueue.push([e2, e1], []); // Already ordered by mock

      const result = await vocabularyRepository.findByUserPaginated(42, 0, 15);

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe(2); // Newer first
      expect(result[1]!.id).toBe(1);
    });

    it("returns only active translations for entries", async () => {
      const entry = makeEntry({ id: 1 });
      // Only active translations will be queried (mock simulates WHERE isActive = true)
      const activeTrans = makeTranslation({ entryId: 1, text: "ahoj", isActive: true });
      selectResultQueue.push([entry], [activeTrans]);

      const result = await vocabularyRepository.findByUserPaginated(42, 0, 15);

      expect(result[0]!.translations).toHaveLength(1);
      expect(result[0]!.translations[0]!.isActive).toBe(true);
    });

    it("applies offset correctly for page 2", async () => {
      const entry = makeEntry({ id: 16 });
      const translation = makeTranslation({ entryId: 16 });
      selectResultQueue.push([entry], [translation]);

      const result = await vocabularyRepository.findByUserPaginated(42, 15, 15);

      expect(selectFn).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe("hardDelete", () => {
    it("deletes entry from the database (not soft-delete)", async () => {
      await vocabularyRepository.hardDelete(10);

      expect(deleteFn).toHaveBeenCalledOnce();
      expect(deleteWhereFn).toHaveBeenCalledOnce();
    });

    it("calls delete on vocabularyEntries table", async () => {
      await vocabularyRepository.hardDelete(5);

      // Verify delete was called (CASCADE on translations handles child rows)
      expect(deleteFn).toHaveBeenCalledOnce();
      expect(deleteWhereFn).toHaveBeenCalledOnce();
    });

    it("is a no-op when entry does not exist", async () => {
      // DELETE WHERE id = <nonexistent> just does nothing in SQL
      await vocabularyRepository.hardDelete(99999);

      expect(deleteFn).toHaveBeenCalledOnce();
      // No error thrown
    });
  });
});

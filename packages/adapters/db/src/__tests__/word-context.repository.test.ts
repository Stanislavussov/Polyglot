import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Drizzle query builder ──────────────────────────────────

const mockRows: unknown[] = [];
let _lastInsertValues: unknown = null;

const returningFn = vi.fn(() => Promise.resolve([...mockRows]));

const insertValuesFn = vi.fn((values: unknown) => {
  _lastInsertValues = values;
  return { returning: returningFn };
});

const insertFn = vi.fn(() => ({ values: insertValuesFn }));

const limitFn = vi.fn((): Promise<unknown[]> => Promise.resolve([...mockRows]));

const selectWhereFn = vi.fn((): unknown => ({
  limit: limitFn,
}));

const innerJoinFn = vi.fn((): unknown => ({
  where: selectWhereFn,
}));

const selectFromFn = vi.fn((): unknown => ({
  where: selectWhereFn,
  innerJoin: innerJoinFn,
}));

const selectFn = vi.fn((..._args: unknown[]): unknown => ({ from: selectFromFn }));

const mockDb = {
  select: selectFn,
  insert: insertFn,
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const { wordContextRepository } = await import("../repositories/word-context.repository.js");

beforeEach(() => {
  mockRows.length = 0;
  _lastInsertValues = null;
  vi.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    word: "что ли",
    languageId: 1,
    pos: "phrase",
    forms: [],
    formTags: ["canonical"],
    glosses: ["or something, perhaps"],
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("wordContextRepository", () => {
  describe("findByWordAndLang", () => {
    it("returns entries for exact word + language id match", async () => {
      const entry = makeEntry();
      // findByWordAndLang: select().from(wc).where(...) — no limit
      selectWhereFn.mockResolvedValueOnce([entry]);

      const result = await wordContextRepository.findByWordAndLang("что ли", 1);

      expect(result).toEqual([entry]);
      expect(selectFn).toHaveBeenCalledOnce();
    });

    it("returns empty array when no match", async () => {
      selectWhereFn.mockResolvedValueOnce([]);

      const result = await wordContextRepository.findByWordAndLang("nonexistent", 1);

      expect(result).toEqual([]);
    });
  });

  describe("findByWordAndLangCode", () => {
    it("returns entries joining with languages table", async () => {
      const entry = makeEntry();
      selectWhereFn.mockResolvedValueOnce([entry]);

      const result = await wordContextRepository.findByWordAndLangCode("что ли", "ru");

      expect(result).toEqual([entry]);
      expect(innerJoinFn).toHaveBeenCalledOnce();
    });

    it("returns empty array when no match by lang code", async () => {
      selectWhereFn.mockResolvedValueOnce([]);

      const result = await wordContextRepository.findByWordAndLangCode("что ли", "en");

      expect(result).toEqual([]);
    });
  });

  describe("search", () => {
    it("returns matching entries with prefix search", async () => {
      const entry = makeEntry({ word: "что ли" });
      mockRows.push(entry);

      const result = await wordContextRepository.search("что", 1, 10);

      expect(result).toHaveLength(1);
      expect(limitFn).toHaveBeenCalledWith(10);
    });

    it("returns empty array when nothing matches", async () => {
      const result = await wordContextRepository.search("xyz", 1);

      expect(result).toEqual([]);
    });

    it("uses default limit of 20", async () => {
      await wordContextRepository.search("что", 1);

      expect(limitFn).toHaveBeenCalledWith(20);
    });
  });

  describe("createBatch", () => {
    it("inserts a batch and returns count", async () => {
      const entries = [makeEntry({ id: 1 }), makeEntry({ id: 2, word: "само собой" })];
      returningFn.mockResolvedValueOnce(entries);

      const count = await wordContextRepository.createBatch([
        {
          word: "что ли",
          languageId: 1,
          pos: "phrase",
          forms: [],
          formTags: ["canonical"],
          glosses: ["or something"],
        },
        {
          word: "само собой",
          languageId: 1,
          pos: "phrase",
          forms: [],
          formTags: ["canonical"],
          glosses: ["of course"],
        },
      ]);

      expect(count).toBe(2);
      expect(insertFn).toHaveBeenCalledOnce();
    });

    it("returns 0 for empty batch without calling insert", async () => {
      const count = await wordContextRepository.createBatch([]);

      expect(count).toBe(0);
      expect(insertFn).not.toHaveBeenCalled();
    });
  });

  describe("countByLanguage", () => {
    it("returns count for a given language", async () => {
      // countByLanguage: select({ count: sql }).from(wc).where(...)
      selectWhereFn.mockResolvedValueOnce([{ count: 42 }]);

      const result = await wordContextRepository.countByLanguage(1);

      expect(result).toBe(42);
    });

    it("returns 0 when no entries", async () => {
      selectWhereFn.mockResolvedValueOnce([]);

      const result = await wordContextRepository.countByLanguage(999);

      expect(result).toBe(0);
    });
  });

  describe("findById", () => {
    it("returns entry when found", async () => {
      const entry = makeEntry({ id: 7 });
      mockRows.push(entry);

      const result = await wordContextRepository.findById(7);

      expect(result).toEqual(entry);
      expect(limitFn).toHaveBeenCalledWith(1);
    });

    it("returns null when not found", async () => {
      const result = await wordContextRepository.findById(999);

      expect(result).toBeNull();
    });
  });
});

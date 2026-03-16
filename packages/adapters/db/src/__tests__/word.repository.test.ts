import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Drizzle query builder ──────────────────────────────────

const mockRows: unknown[] = [];
let lastInsertValues: unknown = null;
let lastUpdateSet: unknown = null;

const returningFn = vi.fn(() => Promise.resolve([...mockRows]));

const insertValuesFn = vi.fn((values: unknown) => {
  lastInsertValues = values;
  return { returning: returningFn };
});

const insertFn = vi.fn(() => ({ values: insertValuesFn }));

const limitFn = vi.fn(() => Promise.resolve([...mockRows]));

const orderByFn = vi.fn(() => Promise.resolve([...mockRows]));

const selectWhereFn = vi.fn(() => ({
  limit: limitFn,
  orderBy: orderByFn,
}));

const selectFromFn = vi.fn(() => ({
  where: selectWhereFn,
  orderBy: orderByFn,
}));

const selectFn = vi.fn(() => ({ from: selectFromFn }));

const updateReturningFn = vi.fn(() => Promise.resolve([...mockRows]));

// where() returns { returning } — works for both updateContent and delete
// (delete ignores the return value, updateContent uses .returning())
const updateWhereFn = vi.fn(() => ({
  returning: updateReturningFn,
}));

const updateSetFn = vi.fn((set: unknown) => {
  lastUpdateSet = set;
  return { where: updateWhereFn };
});

const updateFn = vi.fn(() => ({ set: updateSetFn }));

const mockDb = {
  select: selectFn,
  insert: insertFn,
  update: updateFn,
};

vi.mock("../index.js", () => ({
  getDb: () => mockDb,
}));

const { wordRepository } = await import(
  "../repositories/word.repository.js"
);

beforeEach(() => {
  mockRows.length = 0;
  lastInsertValues = null;
  lastUpdateSet = null;
  vi.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────

function makeWord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 42,
    original: "hello",
    sourceLang: "en",
    content: {
      cs: { translation: "ahoj", language: "Czech" },
    },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("wordRepository", () => {
  describe("create", () => {
    it("inserts a new word with userId", async () => {
      const word = makeWord();
      mockRows.push(word);

      const result = await wordRepository.create(42, {
        original: "hello",
        sourceLang: "en",
        content: { cs: { translation: "ahoj" } },
      });

      expect(result).toEqual(word);
      expect(insertFn).toHaveBeenCalledOnce();
      expect(lastInsertValues).toMatchObject({
        userId: 42,
        original: "hello",
        sourceLang: "en",
      });
    });

    it("returns the created word row", async () => {
      const word = makeWord({ id: 99 });
      mockRows.push(word);

      const result = await wordRepository.create(1, {
        original: "test",
        sourceLang: "en",
        content: {},
      });

      expect(result.id).toBe(99);
      expect(returningFn).toHaveBeenCalled();
    });
  });

  describe("findByUser", () => {
    it("returns all active words for a user", async () => {
      const w1 = makeWord({ id: 1 });
      const w2 = makeWord({ id: 2, original: "world" });
      mockRows.push(w1, w2);

      const result = await wordRepository.findByUser(42);

      expect(result).toHaveLength(2);
      expect(selectFn).toHaveBeenCalledOnce();
    });

    it("returns empty array when user has no words", async () => {
      const result = await wordRepository.findByUser(999);

      expect(result).toEqual([]);
    });
  });

  describe("findById", () => {
    it("returns the word when found", async () => {
      const word = makeWord({ id: 7 });
      mockRows.push(word);

      const result = await wordRepository.findById(7);

      expect(result).toEqual(word);
      expect(limitFn).toHaveBeenCalledWith(1);
    });

    it("returns null when not found", async () => {
      const result = await wordRepository.findById(999);

      expect(result).toBeNull();
    });
  });

  describe("search", () => {
    it("returns matching words", async () => {
      const word = makeWord({ original: "hello world" });
      mockRows.push(word);

      const result = await wordRepository.search(42, "hello");

      expect(result).toHaveLength(1);
      expect(selectFn).toHaveBeenCalledOnce();
    });

    it("returns empty array when nothing matches", async () => {
      const result = await wordRepository.search(42, "xyz");

      expect(result).toEqual([]);
    });
  });

  describe("updateContent", () => {
    it("updates content JSONB and returns the updated word", async () => {
      const mergedContent = {
        cs: { translation: "ahoj", language: "Czech" },
        de: { translation: "hallo", language: "German" },
      };
      const updatedWord = makeWord({ content: mergedContent });
      updateReturningFn.mockResolvedValueOnce([updatedWord]);

      const result = await wordRepository.updateContent(1, mergedContent);

      expect(result).toEqual(updatedWord);
      expect(updateFn).toHaveBeenCalledOnce();
      expect(lastUpdateSet).toMatchObject({ content: mergedContent });
    });

    it("sets updatedAt timestamp on content update", async () => {
      const before = new Date();
      const word = makeWord();
      updateReturningFn.mockResolvedValueOnce([word]);

      await wordRepository.updateContent(1, { cs: {} });

      const after = new Date();
      const updatedAt = (lastUpdateSet as Record<string, unknown>)[
        "updatedAt"
      ] as Date;
      expect(updatedAt).toBeInstanceOf(Date);
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("only sets content and updatedAt — no other fields", async () => {
      const word = makeWord();
      updateReturningFn.mockResolvedValueOnce([word]);

      await wordRepository.updateContent(5, { fr: { translation: "bonjour" } });

      const setKeys = Object.keys(lastUpdateSet as object);
      expect(setKeys).toContain("content");
      expect(setKeys).toContain("updatedAt");
      expect(setKeys).toHaveLength(2);
    });
  });

  describe("delete", () => {
    it("soft-deletes by setting isActive to false", async () => {
      await wordRepository.delete(10);

      expect(updateFn).toHaveBeenCalledOnce();
      expect(lastUpdateSet).toMatchObject({ isActive: false });
      expect(lastUpdateSet).toHaveProperty("updatedAt");
    });
  });
});

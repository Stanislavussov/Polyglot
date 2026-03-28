import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Drizzle query builder ──────────────────────────────────
// We mock getDb() to return a chainable query builder that records calls.

const mockRows: unknown[] = [];
let _lastInsertValues: unknown = null;
let lastUpdateSet: unknown = null;
let _lastWhereArgs: unknown = null;

const returningFn = vi.fn(() => Promise.resolve(mockRows));

const onConflictDoUpdateFn = vi.fn(() => ({ returning: returningFn }));

const insertValuesFn = vi.fn((values: unknown) => {
  _lastInsertValues = values;
  return { onConflictDoUpdate: onConflictDoUpdateFn, returning: returningFn };
});

const insertFn = vi.fn(() => ({ values: insertValuesFn }));

const limitFn = vi.fn(() => Promise.resolve(mockRows));

const selectWhereFn = vi.fn((args: unknown) => {
  _lastWhereArgs = args;
  return { limit: limitFn };
});

const selectFromFn = vi.fn(() => ({ where: selectWhereFn }));

const selectFn = vi.fn(() => ({ from: selectFromFn }));

const updateWhereFn = vi.fn(() => Promise.resolve());

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

// Import after mock is set up
const { topicRepository } = await import("../repositories/topic.repository.js");

beforeEach(() => {
  mockRows.length = 0;
  _lastInsertValues = null;
  lastUpdateSet = null;
  _lastWhereArgs = null;
  vi.clearAllMocks();
});

describe("topicRepository", () => {
  describe("getCached", () => {
    it("returns a cached translation when found", async () => {
      const cached = {
        id: 1,
        topicId: "food",
        original: "apple",
        sourceLang: "en",
        targetLang: "cs",
        content: { translation: "jablko" },
        isValid: true,
        invalidReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockRows.push(cached);

      const result = await topicRepository.getCached("food", "apple", "en", "cs");

      expect(result).toBe(cached);
      expect(selectFn).toHaveBeenCalledOnce();
    });

    it("returns null when not found", async () => {
      // mockRows is empty
      const result = await topicRepository.getCached("food", "nonexistent", "en", "cs");

      expect(result).toBeNull();
    });
  });

  describe("setCached", () => {
    it("inserts a new cache entry with upsert", async () => {
      const newEntry = {
        topicId: "food",
        original: "apple",
        sourceLang: "en",
        targetLang: "cs",
        content: { translation: "jablko" },
      };

      const returned = {
        id: 1,
        ...newEntry,
        isValid: true,
        invalidReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockRows.push(returned);

      const result = await topicRepository.setCached(newEntry);

      expect(result).toBe(returned);
      expect(insertFn).toHaveBeenCalledOnce();
      expect(insertValuesFn).toHaveBeenCalledWith(newEntry);
      expect(onConflictDoUpdateFn).toHaveBeenCalledOnce();
    });
  });

  describe("markInvalid", () => {
    it("marks a cached entry as invalid with reason", async () => {
      await topicRepository.markInvalid(42, "model changed");

      expect(updateFn).toHaveBeenCalledOnce();
      expect(updateSetFn).toHaveBeenCalledOnce();
      // Verify the set object contains isValid: false and the reason
      expect(lastUpdateSet).toMatchObject({
        isValid: false,
        invalidReason: "model changed",
      });
      expect(updateWhereFn).toHaveBeenCalledOnce();
    });
  });
});

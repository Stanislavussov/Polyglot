import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Drizzle query builder ──────────────────────────────────

const mockRows: unknown[] = [];
let lastInsertValues: unknown = null;

const returningFn = vi.fn(() => Promise.resolve([...mockRows]));
const onConflictDoNothingFn = vi.fn(() => ({ returning: returningFn }));

const insertValuesFn = vi.fn((values: unknown) => {
  lastInsertValues = values;
  return { returning: returningFn, onConflictDoNothing: onConflictDoNothingFn };
});

const insertFn = vi.fn(() => ({ values: insertValuesFn }));

const limitFn = vi.fn((): Promise<unknown[]> => Promise.resolve([...mockRows]));

const selectWhereFn = vi.fn((): unknown => ({
  limit: limitFn,
}));

const selectFromFn = vi.fn((): unknown => ({
  where: selectWhereFn,
}));

const selectFn = vi.fn((): unknown => ({ from: selectFromFn }));

const mockDb = {
  select: selectFn,
  insert: insertFn,
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const { languageRepository } = await import("../repositories/language.repository.js");

beforeEach(() => {
  mockRows.length = 0;
  lastInsertValues = null;
  vi.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────

function makeLang(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    code: "ru",
    name: "Russian",
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("languageRepository", () => {
  describe("findByCode", () => {
    it("returns a language when found", async () => {
      const lang = makeLang();
      mockRows.push(lang);

      const result = await languageRepository.findByCode("ru");

      expect(result).toEqual(lang);
      expect(selectFn).toHaveBeenCalledOnce();
      expect(limitFn).toHaveBeenCalledWith(1);
    });

    it("returns null when not found", async () => {
      const result = await languageRepository.findByCode("xx");

      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("inserts a new language and returns it", async () => {
      const lang = makeLang({ id: 5, code: "de", name: "German" });
      mockRows.push(lang);

      const result = await languageRepository.create({
        code: "de",
        name: "German",
      });

      expect(result).toEqual(lang);
      expect(insertFn).toHaveBeenCalledOnce();
      expect(lastInsertValues).toMatchObject({ code: "de", name: "German" });
    });
  });

  describe("getOrCreate", () => {
    it("returns newly inserted language when it does not exist", async () => {
      const lang = makeLang({ id: 3, code: "cs", name: "Czech" });
      // onConflictDoNothing().returning() returns the inserted row
      returningFn.mockResolvedValueOnce([lang]);

      const result = await languageRepository.getOrCreate("cs", "Czech");

      expect(result).toEqual(lang);
      expect(onConflictDoNothingFn).toHaveBeenCalledOnce();
    });

    it("falls back to SELECT when insert returns empty (conflict)", async () => {
      // First call: onConflictDoNothing returns empty (conflict)
      returningFn.mockResolvedValueOnce([]);

      // Second call: select finds it
      const existingLang = makeLang({ id: 1, code: "ru", name: "Russian" });
      mockRows.push(existingLang);

      const result = await languageRepository.getOrCreate("ru", "Russian");

      expect(result).toEqual(existingLang);
      expect(selectFn).toHaveBeenCalledOnce();
    });
  });

  describe("findAll", () => {
    it("returns all languages", async () => {
      // For findAll, the chain is select().from(languages) — no where/limit
      // selectFromFn returns the promise directly here (no .where)
      const langs = [makeLang(), makeLang({ id: 2, code: "en", name: "English" })];
      selectFromFn.mockResolvedValueOnce(langs);

      const result = await languageRepository.findAll();

      expect(result).toHaveLength(2);
      expect(selectFn).toHaveBeenCalledOnce();
    });

    it("returns empty array when no languages", async () => {
      selectFromFn.mockResolvedValueOnce([]);

      const result = await languageRepository.findAll();

      expect(result).toEqual([]);
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateVocabularyInput,
  VocabTranslationDetails,
  VocabularyEntry,
  VocabularyTranslation,
} from "../repositories/vocabulary.repository.js";

// ── Mock Drizzle query builder ──────────────────────────────────
// Drizzle's select builder is thenable (you can await .where() directly)
// AND has chainable methods (.limit(), .orderBy()).
// We use a queue to return different results for successive queries.

let selectResultQueue: unknown[][] = [];
let insertResultQueue: unknown[][] = [];
let lastUpdateSet: unknown = null;

/**
 * Creates a thenable object that mimics Drizzle's query builder chain.
 * Drizzle builders are both awaitable and chainable (.limit(), .orderBy()).
 */
function makeThenable(resultFn: () => unknown[]) {
  const promise = Promise.resolve().then(() => resultFn());
  return {
    // biome-ignore lint/suspicious/noThenProperty: mimicking Drizzle's thenable query builder for tests
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    limit: vi.fn(() => makeThenable(resultFn)),
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

const insertReturningFn = vi.fn(() => {
  const result = insertResultQueue.shift() ?? [];
  return Promise.resolve(result);
});

const insertValuesFn = vi.fn((_values: unknown) => {
  return { returning: insertReturningFn };
});

const insertFn = vi.fn(() => ({ values: insertValuesFn }));

const updateReturningFn = vi.fn(() => {
  const result = insertResultQueue.shift() ?? [];
  return Promise.resolve(result);
});

const updateWhereFn = vi.fn(() => ({
  returning: updateReturningFn,
}));

const updateSetFn = vi.fn((set: unknown) => {
  lastUpdateSet = set;
  return { where: updateWhereFn };
});

const updateFn = vi.fn(() => ({ set: updateSetFn }));

const deleteWhereFn = vi.fn(() => Promise.resolve());
const deleteFn = vi.fn(() => ({ where: deleteWhereFn }));

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
  insertResultQueue = [];
  lastUpdateSet = null;
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

function makeCreateInput(overrides: Partial<CreateVocabularyInput> = {}): CreateVocabularyInput {
  return {
    original: "hello",
    sourceLangId: 5,
    inputType: "word",
    emoji: "👋",
    translations: [
      {
        targetLangId: 3,
        text: "ahoj",
        details: makeDetails(),
      },
    ],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("vocabularyRepository", () => {
  describe("create", () => {
    it("inserts parent entry + translation rows and returns full entry", async () => {
      const entry = makeEntry();
      const translation = makeTranslation();
      insertResultQueue.push([entry], [translation]);

      const result = await vocabularyRepository.create(42, makeCreateInput());

      expect(transactionFn).toHaveBeenCalledOnce();
      expect(insertFn).toHaveBeenCalledTimes(2);
      expect(result.id).toBe(1);
      expect(result.original).toBe("hello");
      expect(result.translations).toHaveLength(1);
      expect(result.translations[0]!.text).toBe("ahoj");
    });

    it("inserts entry only when translations array is empty", async () => {
      const entry = makeEntry();
      insertResultQueue.push([entry]);

      const result = await vocabularyRepository.create(42, makeCreateInput({ translations: [] }));

      expect(transactionFn).toHaveBeenCalledOnce();
      expect(insertFn).toHaveBeenCalledTimes(1);
      expect(result.translations).toEqual([]);
    });

    it("passes correct values for parent insert", async () => {
      const entry = makeEntry();
      insertResultQueue.push([entry]);

      await vocabularyRepository.create(42, makeCreateInput());

      const firstInsertValues = insertValuesFn.mock.calls[0]![0];
      expect(firstInsertValues).toMatchObject({
        userId: 42,
        original: "hello",
        sourceLangId: 5,
        inputType: "word",
        emoji: "👋",
      });
    });

    it("passes correct values for translation insert", async () => {
      const entry = makeEntry();
      const translation = makeTranslation();
      insertResultQueue.push([entry], [translation]);

      await vocabularyRepository.create(42, makeCreateInput());

      const secondInsertValues = insertValuesFn.mock.calls[1]![0];
      expect(secondInsertValues).toEqual([
        expect.objectContaining({
          entryId: 1,
          targetLangId: 3,
          text: "ahoj",
        }),
      ]);
    });

    it("handles multiple translations", async () => {
      const entry = makeEntry();
      const t1 = makeTranslation({ id: 10, targetLangId: 3, text: "ahoj" });
      const t2 = makeTranslation({ id: 11, targetLangId: 7, text: "hallo" });
      insertResultQueue.push([entry], [t1, t2]);

      const input = makeCreateInput({
        translations: [
          { targetLangId: 3, text: "ahoj", details: makeDetails() },
          { targetLangId: 7, text: "hallo", details: makeDetails() },
        ],
      });

      const result = await vocabularyRepository.create(42, input);

      expect(result.translations).toHaveLength(2);
    });
  });

  describe("findByOriginalAndSource", () => {
    it("returns entry with translations when match exists", async () => {
      const entry = makeEntry({ id: 7, original: "hello", sourceLangId: 5 });
      const translation = makeTranslation({ entryId: 7 });
      // First select: entry, second select: translations
      selectResultQueue.push([entry], [translation]);

      const result = await vocabularyRepository.findByOriginalAndSource(42, "hello", 5);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(7);
      expect(result!.translations).toHaveLength(1);
      expect(result!.translations[0]!.text).toBe("ahoj");
    });

    it("returns null when no match found", async () => {
      selectResultQueue.push([]);

      const result = await vocabularyRepository.findByOriginalAndSource(42, "nonexistent", 5);

      expect(result).toBeNull();
    });
  });

  describe("findByUser", () => {
    it("returns entries with translations ordered by createdAt DESC", async () => {
      const e1 = makeEntry({ id: 1 });
      const e2 = makeEntry({ id: 2, original: "world" });
      const t1 = makeTranslation({ entryId: 1 });
      const t2 = makeTranslation({ id: 11, entryId: 2, text: "svět" });
      // First select: entries, second select: translations
      selectResultQueue.push([e1, e2], [t1, t2]);

      const result = await vocabularyRepository.findByUser(42);

      expect(result).toHaveLength(2);
      expect(result[0]!.translations).toHaveLength(1);
      expect(result[1]!.translations).toHaveLength(1);
    });

    it("returns empty array when user has no entries", async () => {
      selectResultQueue.push([]);

      const result = await vocabularyRepository.findByUser(999);

      expect(result).toEqual([]);
    });
  });

  describe("findById", () => {
    it("returns entry with translations when found", async () => {
      const entry = makeEntry({ id: 7 });
      const translation = makeTranslation({ entryId: 7 });
      selectResultQueue.push([entry], [translation]);

      const result = await vocabularyRepository.findById(7);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(7);
      expect(result!.translations).toHaveLength(1);
    });

    it("returns null when not found", async () => {
      selectResultQueue.push([]);

      const result = await vocabularyRepository.findById(999);

      expect(result).toBeNull();
    });
  });

  describe("search", () => {
    it("returns matching entries with translations", async () => {
      const entry = makeEntry({ original: "hello world" });
      const translation = makeTranslation({ entryId: 1 });
      selectResultQueue.push([entry], [translation]);

      const result = await vocabularyRepository.search(42, "hello");

      expect(result).toHaveLength(1);
      expect(result[0]!.translations).toHaveLength(1);
    });

    it("returns empty array when nothing matches", async () => {
      selectResultQueue.push([]);

      const result = await vocabularyRepository.search(42, "xyz");

      expect(result).toEqual([]);
    });
  });

  describe("findByUserAndLang", () => {
    it("returns entries with only matching target language translations", async () => {
      const translation = makeTranslation({ entryId: 1, targetLangId: 3 });
      const entry = makeEntry({ id: 1 });
      // First select: translations by targetLangId, second select: entries
      selectResultQueue.push([translation], [entry]);

      const result = await vocabularyRepository.findByUserAndLang(42, 3);

      expect(result).toHaveLength(1);
      expect(result[0]!.translations[0]!.targetLangId).toBe(3);
    });

    it("returns empty array when no translations for target language", async () => {
      selectResultQueue.push([]);

      const result = await vocabularyRepository.findByUserAndLang(42, 99);

      expect(result).toEqual([]);
    });
  });

  describe("updateTranslation", () => {
    it("updates only the specified language row", async () => {
      const updated = makeTranslation({ text: "nazdar" });
      insertResultQueue.push([updated]);

      const result = await vocabularyRepository.updateTranslation(1, 3, { text: "nazdar" });

      expect(updateFn).toHaveBeenCalledOnce();
      expect(result.text).toBe("nazdar");
    });

    it("sets updatedAt on update", async () => {
      const before = new Date();
      const updated = makeTranslation();
      insertResultQueue.push([updated]);

      await vocabularyRepository.updateTranslation(1, 3, { text: "updated" });

      const after = new Date();
      const setData = lastUpdateSet as Record<string, unknown>;
      expect(setData.updatedAt).toBeInstanceOf(Date);
      expect((setData.updatedAt as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect((setData.updatedAt as Date).getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("upserts (inserts) when no existing row for entry+lang", async () => {
      // First: update returns empty (no existing row)
      insertResultQueue.push([]);
      // Then: insert returns new row
      const inserted = makeTranslation({ text: "new" });
      insertResultQueue.push([inserted]);

      const result = await vocabularyRepository.updateTranslation(1, 99, { text: "new" });

      expect(updateFn).toHaveBeenCalledOnce();
      expect(insertFn).toHaveBeenCalledOnce();
      expect(result.text).toBe("new");
    });
  });

  describe("updateAllTranslations", () => {
    it("deletes old and inserts new translations in a transaction", async () => {
      const t1 = makeTranslation({ id: 20, text: "ahoj" });
      const t2 = makeTranslation({ id: 21, text: "hallo", targetLangId: 7 });
      insertResultQueue.push([t1, t2]);

      const result = await vocabularyRepository.updateAllTranslations(1, [
        { text: "ahoj", details: makeDetails() },
        { text: "hallo", targetLangId: 7, details: makeDetails() },
      ]);

      expect(transactionFn).toHaveBeenCalledOnce();
      expect(deleteFn).toHaveBeenCalledOnce();
      expect(insertFn).toHaveBeenCalledOnce();
      expect(result).toHaveLength(2);
    });

    it("returns empty array when translations list is empty", async () => {
      const result = await vocabularyRepository.updateAllTranslations(1, []);

      expect(transactionFn).toHaveBeenCalledOnce();
      expect(deleteFn).toHaveBeenCalledOnce();
      expect(insertFn).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe("delete", () => {
    it("soft-deletes parent and all translations", async () => {
      await vocabularyRepository.delete(10);

      expect(updateFn).toHaveBeenCalledTimes(2);
      const sets = updateSetFn.mock.calls.map((c) => c[0]);
      expect(sets[0]).toMatchObject({ isActive: false });
      expect(sets[1]).toMatchObject({ isActive: false });
      expect(sets[0]).toHaveProperty("updatedAt");
      expect(sets[1]).toHaveProperty("updatedAt");
    });
  });

  describe("findByUserWithSourceLang", () => {
    it("resolves sourceLangId to code using langResolver", async () => {
      const entry = makeEntry({ id: 1, sourceLangId: 5 });
      const translation = makeTranslation({ entryId: 1 });
      // findByUser internally: entries, then translations
      selectResultQueue.push([entry], [translation]);

      const resolver = (id: number) => (id === 5 ? "en" : undefined);
      const result = await vocabularyRepository.findByUserWithSourceLang(42, resolver);

      expect(result).toHaveLength(1);
      expect(result[0]!.sourceLangCode).toBe("en");
    });

    it("filters out entries with unresolvable sourceLangId", async () => {
      const entry = makeEntry({ id: 1, sourceLangId: 999 });
      const translation = makeTranslation({ entryId: 1 });
      selectResultQueue.push([entry], [translation]);

      const resolver = (_id: number) => undefined;
      const result = await vocabularyRepository.findByUserWithSourceLang(42, resolver);

      expect(result).toEqual([]);
    });
  });
});

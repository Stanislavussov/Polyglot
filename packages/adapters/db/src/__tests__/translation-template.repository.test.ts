import type { TemplateFields } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Drizzle query builder ──────────────────────────────────

const mockRows: unknown[] = [];
let lastInsertValues: unknown = null;

const returningFn = vi.fn(() => Promise.resolve([...mockRows]));

const onConflictDoUpdateFn = vi.fn((_set: Record<string, unknown>) => ({ returning: returningFn }));

const insertValuesFn = vi.fn((values: unknown) => {
  lastInsertValues = values;
  return { onConflictDoUpdate: onConflictDoUpdateFn, returning: returningFn };
});

const insertFn = vi.fn(() => ({ values: insertValuesFn }));

const limitFn = vi.fn(() => Promise.resolve([...mockRows]));

const selectWhereFn = vi.fn(() => ({
  limit: limitFn,
}));

const selectFromFn = vi.fn(() => ({
  where: selectWhereFn,
}));

const selectFn = vi.fn(() => ({ from: selectFromFn }));

const deleteWhereFn = vi.fn(() => Promise.resolve());

const deleteFromFn = vi.fn(() => ({
  where: deleteWhereFn,
}));

const deleteFn = vi.fn(() => deleteFromFn());

const mockDb = {
  select: selectFn,
  insert: insertFn,
  delete: deleteFn,
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const { translationTemplateRepository } = await import("../repositories/translation-template.repository.js");

beforeEach(() => {
  mockRows.length = 0;
  lastInsertValues = null;
  vi.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────

/** Create a mock DB row with individual boolean columns (not JSONB) */
function makeTemplateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 42,
    name: "Custom",
    transcription: true,
    synonyms: true,
    examples: true,
    alternatives: true,
    equivalentNote: true,
    connotationWarning: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeFields(overrides: Partial<TemplateFields> = {}): TemplateFields {
  return {
    transcription: true,
    synonyms: true,
    examples: true,
    alternatives: true,
    equivalentNote: true,
    connotationWarning: true,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("translationTemplateRepository", () => {
  describe("getByUserId", () => {
    it("returns null when user has no template", async () => {
      const result = await translationTemplateRepository.getByUserId(42);

      expect(result).toBeNull();
      expect(selectFn).toHaveBeenCalledOnce();
      expect(limitFn).toHaveBeenCalledWith(1);
    });

    it("returns saved template with fields assembled from columns", async () => {
      const row = makeTemplateRow();
      mockRows.push(row);

      const result = await translationTemplateRepository.getByUserId(42);

      expect(result).toEqual({
        id: 1,
        userId: 42,
        name: "Custom",
        fields: makeFields(),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    });

    it("reads individual boolean columns into TemplateFields", async () => {
      const row = makeTemplateRow({ synonyms: false, examples: false });
      mockRows.push(row);

      const result = await translationTemplateRepository.getByUserId(42);

      expect(result!.fields).toEqual({
        transcription: true,
        synonyms: false,
        examples: false,
        alternatives: true,
        equivalentNote: true,
        connotationWarning: true,
      });
    });

    it("all-false columns produce all-false fields", async () => {
      const row = makeTemplateRow({
        transcription: false,
        synonyms: false,
        examples: false,
        alternatives: false,
        equivalentNote: false,
        connotationWarning: false,
      });
      mockRows.push(row);

      const result = await translationTemplateRepository.getByUserId(42);

      expect(result!.fields).toEqual(
        makeFields({
          transcription: false,
          synonyms: false,
          examples: false,
          alternatives: false,
          equivalentNote: false,
          connotationWarning: false,
        }),
      );
    });
  });

  describe("upsert", () => {
    it("creates a new template with individual column values", async () => {
      const fields = makeFields({ synonyms: false });
      const row = makeTemplateRow({ ...fields, name: "My Template" });
      mockRows.push(row);

      const result = await translationTemplateRepository.upsert(42, "My Template", fields);

      expect(result).toEqual({
        id: 1,
        userId: 42,
        name: "My Template",
        fields,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      expect(insertFn).toHaveBeenCalledOnce();
      expect(lastInsertValues).toMatchObject({
        userId: 42,
        name: "My Template",
        transcription: true,
        synonyms: false,
        examples: true,
        alternatives: true,
        equivalentNote: true,
        connotationWarning: true,
      });
    });

    it("uses onConflictDoUpdate for upsert behavior", async () => {
      const fields = makeFields();
      const row = makeTemplateRow();
      mockRows.push(row);

      await translationTemplateRepository.upsert(42, "Custom", fields);

      expect(onConflictDoUpdateFn).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conflictCall = onConflictDoUpdateFn.mock.calls[0]![0] as unknown as Record<string, unknown>;
      const setObj = (conflictCall?.set ?? {}) as Record<string, unknown>;
      expect(setObj).toHaveProperty("name", "Custom");
      expect(setObj).toHaveProperty("transcription", true);
      expect(setObj).toHaveProperty("synonyms", true);
      expect(setObj).toHaveProperty("examples", true);
      expect(setObj).toHaveProperty("alternatives", true);
      expect(setObj).toHaveProperty("equivalentNote", true);
      expect(setObj).toHaveProperty("connotationWarning", true);
      expect(setObj).toHaveProperty("updatedAt");
    });

    it("updates existing template — updatedAt changes", async () => {
      const before = new Date();
      const fields = makeFields({ examples: false });
      const row = makeTemplateRow({ examples: false });
      mockRows.push(row);

      await translationTemplateRepository.upsert(42, "Custom", fields);

      const after = new Date();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conflictCall = onConflictDoUpdateFn.mock.calls[0]![0] as unknown as Record<string, unknown>;
      const setObj = (conflictCall?.set ?? {}) as Record<string, unknown>;
      const updatedAt = setObj.updatedAt as Date;
      expect(updatedAt).toBeInstanceOf(Date);
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("spreads fields into individual columns, not JSONB", async () => {
      const fields = makeFields({ connotationWarning: false, transcription: false });
      const row = makeTemplateRow({ connotationWarning: false, transcription: false });
      mockRows.push(row);

      await translationTemplateRepository.upsert(42, "Custom", fields);

      // Verify values were spread into individual columns
      expect(lastInsertValues).not.toHaveProperty("fields");
      expect(lastInsertValues).toMatchObject({
        transcription: false,
        connotationWarning: false,
      });
    });
  });

  describe("deleteByUserId", () => {
    it("deletes the user's template", async () => {
      await translationTemplateRepository.deleteByUserId(42);

      expect(deleteFn).toHaveBeenCalledOnce();
      expect(deleteWhereFn).toHaveBeenCalledOnce();
    });

    it("subsequent getByUserId returns null after delete", async () => {
      await translationTemplateRepository.deleteByUserId(42);

      const result = await translationTemplateRepository.getByUserId(42);

      expect(result).toBeNull();
    });
  });
});

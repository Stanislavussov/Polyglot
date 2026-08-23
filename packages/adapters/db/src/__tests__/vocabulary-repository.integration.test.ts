/**
 * Vocabulary repository — real-DB integration tests (Task 71, Phase 3).
 *
 * Runs against a real, migrated Postgres branch. Every test provisions its own
 * user (unique telegram id) and scopes every read and write to that user's own
 * rows. No shared fixtures, no cleanup between tests, no unscoped mutation.
 *
 * "Per-user retention" here is the entity-scoped soft-delete / reactivation
 * lifecycle the repository actually implements (verified against
 * vocabulary.repository.ts) — there is no vocabulary retention-horizon in the
 * codebase; the only time-ranged sweep (retention.ts) is global telemetry and is
 * intentionally excluded from this parallel lane.
 */
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { languageRepository } from "../repositories/language.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import type { CreateVocabularyInput } from "../repositories/vocabulary.repository.js";
import { vocabularyRepository } from "../repositories/vocabulary.repository.js";
import { vocabularyEntries } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

/** Resolve a seeded language id by ISO code (rows arrive via the migrations). */
async function langId(code: string): Promise<number> {
  const lang = await languageRepository.findByCode(code);
  if (!lang) throw new Error(`Expected seeded language '${code}' to exist on the migrated branch`);
  return lang.id;
}

async function freshUserId(): Promise<number> {
  const user = await userRepository.create({ telegramId: uniqueTelegramId(), username: "vocab-test" });
  return user.id;
}

function entryInput(
  original: string,
  sourceLangId: number,
  targetLangId: number,
  text = "translation",
): CreateVocabularyInput {
  return {
    original,
    sourceLangId,
    inputType: "word",
    emoji: "📘",
    translations: [{ targetLangId, text, details: { synonyms: [], examples: [] } }],
  };
}

describe("vocabularyRepository (integration)", () => {
  it("persists an entry and retrieves it by user + word + source lang", async () => {
    const userId = await freshUserId();
    const es = await langId("es");
    const en = await langId("en");

    const created = await vocabularyRepository.create(userId, entryInput("hola", es, en, "hello"));
    expect(created.id).toBeGreaterThan(0);
    expect(created.translations).toHaveLength(1);
    expect(created.translations[0]?.text).toBe("hello");

    const found = await vocabularyRepository.findByOriginalAndSource(userId, "hola", es);
    expect(found?.id).toBe(created.id);
    expect(found?.original).toBe("hola");
  });

  it("paginates a single user's entries into stable, non-overlapping slices", async () => {
    const userId = await freshUserId();
    const es = await langId("es");
    const en = await langId("en");

    // Distinct originals so "alpha" ordering is deterministic under equal createdAt.
    const words = ["alfa", "bravo", "charlie", "delta", "echo"];
    for (const word of words) {
      await vocabularyRepository.create(userId, entryInput(word, es, en));
    }

    const page1 = await vocabularyRepository.findByUserPaginated(userId, 0, 2, undefined, { sort: "alpha" });
    const page2 = await vocabularyRepository.findByUserPaginated(userId, 2, 2, undefined, { sort: "alpha" });
    const page3 = await vocabularyRepository.findByUserPaginated(userId, 4, 2, undefined, { sort: "alpha" });

    expect(page1.map((e) => e.original)).toEqual(["alfa", "bravo"]);
    expect(page2.map((e) => e.original)).toEqual(["charlie", "delta"]);
    expect(page3.map((e) => e.original)).toEqual(["echo"]);

    // No overlap across pages.
    const allIds = [...page1, ...page2, ...page3].map((e) => e.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("treats %/_ in a search term as literal characters (LIKE escaping)", async () => {
    const userId = await freshUserId();
    const es = await langId("es");
    const en = await langId("en");

    await vocabularyRepository.create(userId, entryInput("50% off", es, en));
    await vocabularyRepository.create(userId, entryInput("plain deal", es, en));
    await vocabularyRepository.create(userId, entryInput("abc_def", es, en));
    await vocabularyRepository.create(userId, entryInput("abcXdef", es, en));

    // '%' is escaped → matches only the literal "50%" row, not every row.
    const percent = await vocabularyRepository.search(userId, "50%");
    expect(percent.map((e) => e.original)).toEqual(["50% off"]);

    // '_' is escaped → matches "abc_def" but NOT "abcXdef" (which a wildcard would).
    const underscore = await vocabularyRepository.search(userId, "abc_def");
    expect(underscore.map((e) => e.original)).toEqual(["abc_def"]);
  });

  it("soft-deletes then reactivates the same row on re-save (entity-scoped retention)", async () => {
    const userId = await freshUserId();
    const es = await langId("es");
    const en = await langId("en");

    const created = await vocabularyRepository.create(userId, entryInput("gato", es, en, "cat"));

    // Soft delete: the active lookup no longer finds it.
    await vocabularyRepository.delete(created.id);
    expect(await vocabularyRepository.findByOriginalAndSource(userId, "gato", es)).toBeNull();

    // Re-save reactivates the SAME row (no duplicate) rather than raising 23505.
    const resaved = await vocabularyRepository.create(userId, entryInput("gato", es, en, "feline"));
    expect(resaved.id).toBe(created.id);

    const rows = await getDb()
      .select()
      .from(vocabularyEntries)
      .where(and(eq(vocabularyEntries.userId, userId), eq(vocabularyEntries.original, "gato")));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isActive).toBe(true);
  });

  it("upserts a duplicate (userId, original, sourceLang) without creating a second row", async () => {
    const userId = await freshUserId();
    const es = await langId("es");
    const en = await langId("en");

    const first = await vocabularyRepository.create(userId, entryInput("perro", es, en, "dog"));
    const second = await vocabularyRepository.create(userId, entryInput("perro", es, en, "hound"));

    expect(second.id).toBe(first.id);

    const rows = await getDb()
      .select()
      .from(vocabularyEntries)
      .where(and(eq(vocabularyEntries.userId, userId), eq(vocabularyEntries.original, "perro")));
    expect(rows).toHaveLength(1);
  });

  it("persists a notification difficulty grade and returns it via findByUser", async () => {
    const userId = await freshUserId();
    const es = await langId("es");
    const en = await langId("en");

    const created = await vocabularyRepository.create(userId, entryInput("lluvia", es, en, "rain"));
    expect((await vocabularyRepository.findByUser(userId))[0]?.difficulty).toBeNull();

    expect(await vocabularyRepository.setDifficulty(created.id, userId, "hard")).toBe(true);
    expect((await vocabularyRepository.findByUser(userId))[0]?.difficulty).toBe("hard");

    // Re-grading overwrites the previous grade.
    expect(await vocabularyRepository.setDifficulty(created.id, userId, "easy")).toBe(true);
    expect((await vocabularyRepository.findByUser(userId))[0]?.difficulty).toBe("easy");
  });

  it("refuses to grade another user's entry or a nonexistent one", async () => {
    const ownerId = await freshUserId();
    const strangerId = await freshUserId();
    const es = await langId("es");
    const en = await langId("en");

    const created = await vocabularyRepository.create(ownerId, entryInput("sol", es, en, "sun"));

    expect(await vocabularyRepository.setDifficulty(created.id, strangerId, "hard")).toBe(false);
    expect((await vocabularyRepository.findByUser(ownerId))[0]?.difficulty).toBeNull();

    expect(await vocabularyRepository.setDifficulty(999_999_999, ownerId, "hard")).toBe(false);

    // A stale button on a removed word must not grade its ghost.
    await vocabularyRepository.delete(created.id);
    expect(await vocabularyRepository.setDifficulty(created.id, ownerId, "hard")).toBe(false);
  });
});

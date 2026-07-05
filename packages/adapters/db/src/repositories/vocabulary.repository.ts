import type {
  CreateVocabularyInput,
  DictionaryListOptions,
  DictionaryListSort,
  SourceUsage,
  SrsDueVocabularyCard,
  UpdateSrsStateInput,
  UpdateTranslationData,
  VocabTranslationDetails,
  VocabularyEntry,
  VocabularyEntryWithSourceLang,
  VocabularyEntryWithTranslations,
  VocabularySource,
  VocabularyTranslation,
} from "@polyglot/core";
import { and, asc, count, desc, eq, ilike, inArray, isNull, lte, notInArray, or, type SQL, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { escapeLikePattern } from "../like-escape.js";
import { vocabularyDictionaryEntries, vocabularyEntries, vocabularyTranslations } from "../schema.js";

export type {
  CreateVocabularyInput,
  DictionaryListOptions,
  DictionaryListSort,
  SourceUsage,
  SrsDueVocabularyCard,
  UpdateSrsStateInput,
  UpdateTranslationData,
  VocabTranslationDetails,
  VocabularyEntry,
  VocabularyEntryWithSourceLang,
  VocabularyEntryWithTranslations,
  VocabularySource,
  VocabularyTranslation,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Groups flat translation rows by entryId and attaches them to entries.
 */
function assembleEntriesWithTranslations(
  entries: VocabularyEntry[],
  translations: VocabularyTranslation[],
): VocabularyEntryWithTranslations[] {
  const translationsByEntry = new Map<number, VocabularyTranslation[]>();
  for (const t of translations) {
    const list = translationsByEntry.get(t.entryId) ?? [];
    list.push(t);
    translationsByEntry.set(t.entryId, list);
  }
  return entries.map((entry) => ({
    ...entry,
    translations: translationsByEntry.get(entry.id) ?? [],
  }));
}

function tomorrow(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date;
}

/** Build a case-insensitive substring filter on the original term, or undefined when no query. */
function originalSearchFilter(search?: string): SQL | undefined {
  const trimmed = search?.trim();
  if (!trimmed) return undefined;
  return ilike(vocabularyEntries.original, `%${escapeLikePattern(trimmed)}%`);
}

/** Resolve the ORDER BY clause for the dictionary browse list. */
function dictionaryListOrder(sort: DictionaryListSort | undefined): SQL {
  return sort === "alpha" ? asc(vocabularyEntries.original) : desc(vocabularyEntries.createdAt);
}

/* ------------------------------------------------------------------ */
/*  Repository                                                         */
/* ------------------------------------------------------------------ */

export const vocabularyRepository = {
  /**
   * Create a vocabulary entry with all its translations.
   * Uses a transaction to ensure atomicity.
   *
   * Saving the same (userId, original, sourceLangId) that was previously
   * soft-deleted **reactivates** the existing row instead of failing on the
   * unique index: the entry (and each conflicting translation) is updated in
   * place with the new content and flipped back to active. This is done with a
   * race-safe `ON CONFLICT DO UPDATE` on the existing unique keys — no
   * check-then-insert window — so a re-save after delete never raises 23505
   * (C2/E1). Translation SRS columns are intentionally left untouched so the
   * card's review history survives reactivation.
   */
  async create(userId: number, input: CreateVocabularyInput): Promise<VocabularyEntryWithTranslations> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [entry] = await tx
        .insert(vocabularyEntries)
        .values({
          userId,
          original: input.original,
          sourceLangId: input.sourceLangId,
          inputType: input.inputType,
          emoji: input.emoji,
          nativeMeaning: input.nativeMeaning,
          sourceUsage: input.sourceUsage,
          source: input.source ?? null,
          unverified: input.unverified ?? false,
        })
        .onConflictDoUpdate({
          target: [vocabularyEntries.userId, vocabularyEntries.original, vocabularyEntries.sourceLangId],
          set: {
            inputType: input.inputType,
            emoji: input.emoji ?? null,
            nativeMeaning: input.nativeMeaning ?? null,
            sourceUsage: input.sourceUsage ?? null,
            source: input.source ?? null,
            unverified: input.unverified ?? false,
            isActive: true,
            updatedAt: new Date(),
          },
        })
        .returning();

      let translations: VocabularyTranslation[] = [];
      if (input.translations.length > 0) {
        translations = await tx
          .insert(vocabularyTranslations)
          .values(
            input.translations.map((t) => ({
              entryId: entry!.id,
              targetLangId: t.targetLangId,
              text: t.text,
              expressionType: t.expressionType,
              equivalentNote: t.equivalentNote,
              usageNote: t.usageNote,
              connotationWarning: t.connotationWarning,
              details: t.details,
              srsDueDate: tomorrow(),
            })),
          )
          .onConflictDoUpdate({
            target: [vocabularyTranslations.entryId, vocabularyTranslations.targetLangId],
            set: {
              // Refresh the content from the row we tried to insert (per-row
              // values via EXCLUDED), reactivate, but keep the SRS columns so
              // review progress is preserved across a delete + re-save.
              text: sql`excluded.text`,
              expressionType: sql`excluded.expression_type`,
              equivalentNote: sql`excluded.equivalent_note`,
              usageNote: sql`excluded.usage_note`,
              connotationWarning: sql`excluded.connotation_warning`,
              details: sql`excluded.details`,
              isActive: true,
              updatedAt: new Date(),
            },
          })
          .returning();
      }

      return { ...entry!, translations };
    });
  },

  /**
   * Find a vocabulary entry by (userId, original, sourceLangId) — duplicate detection.
   * Returns the entry with all its translations, or null if not found.
   */
  async findByOriginalAndSource(
    userId: number,
    original: string,
    sourceLangId: number,
  ): Promise<VocabularyEntryWithTranslations | null> {
    const db = getDb();
    const entries = await db
      .select()
      .from(vocabularyEntries)
      .where(
        and(
          eq(vocabularyEntries.userId, userId),
          eq(vocabularyEntries.original, original),
          eq(vocabularyEntries.sourceLangId, sourceLangId),
          eq(vocabularyEntries.isActive, true),
        ),
      )
      .limit(1);

    if (entries.length === 0) return null;

    const entry = entries[0]!;
    const translations = await db
      .select()
      .from(vocabularyTranslations)
      .where(and(eq(vocabularyTranslations.entryId, entry.id), eq(vocabularyTranslations.isActive, true)));

    return { ...entry, translations };
  },

  /**
   * List the `original` strings of a user's active vocabulary entries in a given
   * source language. Lightweight (no translations) — used to exclude already-saved
   * words from video-vocabulary extraction so they are never regenerated.
   */
  async findOriginalsByUserAndSource(userId: number, sourceLangId: number): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .select({ original: vocabularyEntries.original })
      .from(vocabularyEntries)
      .where(
        and(
          eq(vocabularyEntries.userId, userId),
          eq(vocabularyEntries.sourceLangId, sourceLangId),
          eq(vocabularyEntries.isActive, true),
        ),
      );
    return rows.map((r) => r.original);
  },

  /**
   * Find all active vocabulary entries for a user with their active translations.
   * Ordered by createdAt DESC.
   */
  async findByUser(userId: number): Promise<VocabularyEntryWithTranslations[]> {
    const db = getDb();
    const entries = await db
      .select()
      .from(vocabularyEntries)
      .where(and(eq(vocabularyEntries.userId, userId), eq(vocabularyEntries.isActive, true)))
      .orderBy(desc(vocabularyEntries.createdAt));

    if (entries.length === 0) return [];

    const entryIds = entries.map((e) => e.id);
    const translations = await db
      .select()
      .from(vocabularyTranslations)
      .where(and(inArray(vocabularyTranslations.entryId, entryIds), eq(vocabularyTranslations.isActive, true)));

    return assembleEntriesWithTranslations(entries, translations);
  },

  /**
   * Find a single vocabulary entry by ID with all its translations.
   */
  async findById(entryId: number): Promise<VocabularyEntryWithTranslations | null> {
    const db = getDb();
    const entries = await db.select().from(vocabularyEntries).where(eq(vocabularyEntries.id, entryId)).limit(1);

    if (entries.length === 0) return null;

    const entry = entries[0]!;
    const translations = await db
      .select()
      .from(vocabularyTranslations)
      .where(eq(vocabularyTranslations.entryId, entry.id));

    return { ...entry, translations };
  },

  /**
   * Search vocabulary entries by original text (case-insensitive).
   */
  async search(userId: number, query: string): Promise<VocabularyEntryWithTranslations[]> {
    const db = getDb();
    const entries = await db
      .select()
      .from(vocabularyEntries)
      .where(
        and(
          eq(vocabularyEntries.userId, userId),
          eq(vocabularyEntries.isActive, true),
          ilike(vocabularyEntries.original, `%${escapeLikePattern(query)}%`),
        ),
      )
      .orderBy(desc(vocabularyEntries.createdAt));

    if (entries.length === 0) return [];

    const entryIds = entries.map((e) => e.id);
    const translations = await db
      .select()
      .from(vocabularyTranslations)
      .where(and(inArray(vocabularyTranslations.entryId, entryIds), eq(vocabularyTranslations.isActive, true)));

    return assembleEntriesWithTranslations(entries, translations);
  },

  /**
   * Find entries that have a translation for a specific target language.
   * Returns only the matching translation (not all languages).
   */
  async findByUserAndLang(userId: number, targetLangId: number): Promise<VocabularyEntryWithTranslations[]> {
    const db = getDb();

    // Find translations for this target language
    const matchingTranslations = await db
      .select()
      .from(vocabularyTranslations)
      .where(and(eq(vocabularyTranslations.targetLangId, targetLangId), eq(vocabularyTranslations.isActive, true)));

    if (matchingTranslations.length === 0) return [];

    const entryIds = [...new Set(matchingTranslations.map((t) => t.entryId))];

    const entries = await db
      .select()
      .from(vocabularyEntries)
      .where(
        and(
          eq(vocabularyEntries.userId, userId),
          eq(vocabularyEntries.isActive, true),
          inArray(vocabularyEntries.id, entryIds),
        ),
      )
      .orderBy(desc(vocabularyEntries.createdAt));

    // Only include the matching translations (not all languages)
    return assembleEntriesWithTranslations(entries, matchingTranslations);
  },

  /** Update entry-level fields (emoji, nativeMeaning, sourceUsage, source). */
  async updateEntry(
    entryId: number,
    data: {
      emoji?: string | null;
      nativeMeaning?: string | null;
      sourceUsage?: SourceUsage | null;
      source?: VocabularySource | null;
    },
  ): Promise<void> {
    const db = getDb();
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.emoji !== undefined) set.emoji = data.emoji;
    if (data.nativeMeaning !== undefined) set.nativeMeaning = data.nativeMeaning;
    if (data.sourceUsage !== undefined) set.sourceUsage = data.sourceUsage;
    if (data.source !== undefined) set.source = data.source;
    await db.update(vocabularyEntries).set(set).where(eq(vocabularyEntries.id, entryId));
  },

  /**
   * Update a single translation row (e.g. for single-language regen).
   * If no row exists for this entry+lang, inserts a new one.
   */
  async updateTranslation(
    entryId: number,
    targetLangId: number,
    data: UpdateTranslationData,
  ): Promise<VocabularyTranslation> {
    const db = getDb();

    // Try update first
    const updated = await db
      .update(vocabularyTranslations)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(vocabularyTranslations.entryId, entryId), eq(vocabularyTranslations.targetLangId, targetLangId)))
      .returning();

    if (updated.length > 0) return updated[0]!;

    // If no row existed (upsert: insert new)
    const [inserted] = await db
      .insert(vocabularyTranslations)
      .values({
        entryId,
        targetLangId,
        text: data.text ?? "",
        expressionType: data.expressionType,
        equivalentNote: data.equivalentNote,
        usageNote: data.usageNote,
        connotationWarning: data.connotationWarning,
        details: data.details,
        srsDueDate: tomorrow(),
      })
      .returning();

    return inserted!;
  },

  /**
   * Replace all translations for an entry (for full card regen).
   *
   * Uses an upsert keyed on (entry_id, target_lang_id) that updates only the
   * content columns and leaves every SRS column untouched — so regenerating a
   * card no longer wipes the user's review progress (E8/T18). Translations for
   * languages no longer present are removed; their SRS state is moot. A newly
   * added language row starts fresh (srsDueDate = tomorrow).
   */
  async updateAllTranslations(
    entryId: number,
    translations: Array<{
      targetLangId: number;
      text: string;
      expressionType?: string;
      equivalentNote?: string;
      usageNote?: string;
      connotationWarning?: string;
      details: VocabTranslationDetails;
    }>,
  ): Promise<VocabularyTranslation[]> {
    const db = getDb();
    return db.transaction(async (tx) => {
      if (translations.length === 0) {
        await tx.delete(vocabularyTranslations).where(eq(vocabularyTranslations.entryId, entryId));
        return [];
      }

      const langIds = translations.map((t) => t.targetLangId);
      // Drop translations for languages that are no longer part of the card.
      await tx
        .delete(vocabularyTranslations)
        .where(
          and(eq(vocabularyTranslations.entryId, entryId), notInArray(vocabularyTranslations.targetLangId, langIds)),
        );

      // Upsert the current set, preserving SRS columns on conflict.
      return tx
        .insert(vocabularyTranslations)
        .values(
          translations.map((t) => ({
            entryId,
            targetLangId: t.targetLangId,
            text: t.text,
            expressionType: t.expressionType,
            equivalentNote: t.equivalentNote,
            usageNote: t.usageNote,
            connotationWarning: t.connotationWarning,
            details: t.details,
            srsDueDate: tomorrow(), // used only for brand-new rows
          })),
        )
        .onConflictDoUpdate({
          target: [vocabularyTranslations.entryId, vocabularyTranslations.targetLangId],
          set: {
            text: sql`excluded.text`,
            expressionType: sql`excluded.expression_type`,
            equivalentNote: sql`excluded.equivalent_note`,
            usageNote: sql`excluded.usage_note`,
            connotationWarning: sql`excluded.connotation_warning`,
            details: sql`excluded.details`,
            updatedAt: new Date(),
          },
        })
        .returning();
    });
  },

  /**
   * Count active vocabulary entries for a user.
   * Returns 0 for users with no entries.
   */
  async countByUser(userId: number, dictionaryId?: number, search?: string): Promise<number> {
    const db = getDb();
    const searchFilter = originalSearchFilter(search);
    if (dictionaryId !== undefined) {
      const result = await db
        .select({ value: count() })
        .from(vocabularyEntries)
        .innerJoin(vocabularyDictionaryEntries, eq(vocabularyEntries.id, vocabularyDictionaryEntries.entryId))
        .where(
          and(
            eq(vocabularyEntries.userId, userId),
            eq(vocabularyEntries.isActive, true),
            eq(vocabularyDictionaryEntries.dictionaryId, dictionaryId),
            searchFilter,
          ),
        );

      return result[0]?.value ?? 0;
    }

    const result = await db
      .select({ value: count() })
      .from(vocabularyEntries)
      .where(and(eq(vocabularyEntries.userId, userId), eq(vocabularyEntries.isActive, true), searchFilter));

    return result[0]?.value ?? 0;
  },

  /**
   * Find SRS-due translation cards for a user.
   * SRS state is per translation row, so a single vocabulary entry can appear
   * once per due target language.
   */
  async findDueForSrs(userId: number, now: Date, limit: number): Promise<SrsDueVocabularyCard[]> {
    const db = getDb();
    const rows = await db
      .select({
        translationId: vocabularyTranslations.id,
        entryId: vocabularyEntries.id,
        original: vocabularyEntries.original,
        sourceLangId: vocabularyEntries.sourceLangId,
        targetLangId: vocabularyTranslations.targetLangId,
        inputType: vocabularyEntries.inputType,
        emoji: vocabularyEntries.emoji,
        nativeMeaning: vocabularyEntries.nativeMeaning,
        sourceUsage: vocabularyEntries.sourceUsage,
        text: vocabularyTranslations.text,
        expressionType: vocabularyTranslations.expressionType,
        equivalentNote: vocabularyTranslations.equivalentNote,
        usageNote: vocabularyTranslations.usageNote,
        connotationWarning: vocabularyTranslations.connotationWarning,
        details: vocabularyTranslations.details,
        srsEaseFactor: vocabularyTranslations.srsEaseFactor,
        srsInterval: vocabularyTranslations.srsInterval,
        srsDueDate: vocabularyTranslations.srsDueDate,
        srsReviewCount: vocabularyTranslations.srsReviewCount,
      })
      .from(vocabularyTranslations)
      .innerJoin(vocabularyEntries, eq(vocabularyTranslations.entryId, vocabularyEntries.id))
      .where(
        and(
          eq(vocabularyEntries.userId, userId),
          eq(vocabularyEntries.isActive, true),
          eq(vocabularyTranslations.isActive, true),
          or(isNull(vocabularyTranslations.srsDueDate), lte(vocabularyTranslations.srsDueDate, now)),
        ),
      )
      .orderBy(asc(vocabularyTranslations.srsDueDate), asc(vocabularyTranslations.createdAt))
      .limit(limit);

    return rows;
  },

  async updateSrsState(translationId: number, state: UpdateSrsStateInput): Promise<void> {
    const db = getDb();
    await db
      .update(vocabularyTranslations)
      .set({
        srsEaseFactor: state.easeFactor,
        srsInterval: state.interval,
        srsDueDate: state.dueDate,
        srsReviewCount: state.reviewCount,
        updatedAt: new Date(),
      })
      .where(eq(vocabularyTranslations.id, translationId));
  },

  /**
   * Find active vocabulary entries for a user with pagination.
   * Returns entries with their active translations, ordered by createdAt DESC.
   */
  async findByUserPaginated(
    userId: number,
    offset: number,
    limit: number,
    dictionaryId?: number,
    options?: DictionaryListOptions,
  ): Promise<VocabularyEntryWithTranslations[]> {
    const db = getDb();
    const order = dictionaryListOrder(options?.sort);
    const searchFilter = originalSearchFilter(options?.search);
    const entries =
      dictionaryId === undefined
        ? await db
            .select()
            .from(vocabularyEntries)
            .where(and(eq(vocabularyEntries.userId, userId), eq(vocabularyEntries.isActive, true), searchFilter))
            .orderBy(order)
            .limit(limit)
            .offset(offset)
        : await db
            .select({
              id: vocabularyEntries.id,
              userId: vocabularyEntries.userId,
              original: vocabularyEntries.original,
              sourceLangId: vocabularyEntries.sourceLangId,
              inputType: vocabularyEntries.inputType,
              emoji: vocabularyEntries.emoji,
              nativeMeaning: vocabularyEntries.nativeMeaning,
              sourceUsage: vocabularyEntries.sourceUsage,
              source: vocabularyEntries.source,
              unverified: vocabularyEntries.unverified,
              isActive: vocabularyEntries.isActive,
              createdAt: vocabularyEntries.createdAt,
              updatedAt: vocabularyEntries.updatedAt,
            })
            .from(vocabularyEntries)
            .innerJoin(vocabularyDictionaryEntries, eq(vocabularyEntries.id, vocabularyDictionaryEntries.entryId))
            .where(
              and(
                eq(vocabularyEntries.userId, userId),
                eq(vocabularyEntries.isActive, true),
                eq(vocabularyDictionaryEntries.dictionaryId, dictionaryId),
                searchFilter,
              ),
            )
            .orderBy(order)
            .limit(limit)
            .offset(offset);

    if (entries.length === 0) return [];

    const entryIds = entries.map((e) => e.id);
    const translations = await db
      .select()
      .from(vocabularyTranslations)
      .where(and(inArray(vocabularyTranslations.entryId, entryIds), eq(vocabularyTranslations.isActive, true)));

    return assembleEntriesWithTranslations(entries, translations);
  },

  /**
   * Hard delete: permanently removes the entry and all its translations from the DB.
   * CASCADE on vocabulary_translations handles child rows.
   */
  async hardDelete(entryId: number): Promise<void> {
    const db = getDb();
    await db.delete(vocabularyEntries).where(eq(vocabularyEntries.id, entryId));
  },

  /**
   * Soft-delete: sets isActive = false on entry and all its translations.
   */
  async delete(entryId: number): Promise<void> {
    const db = getDb();
    const now = new Date();
    await db
      .update(vocabularyEntries)
      .set({ isActive: false, updatedAt: now })
      .where(eq(vocabularyEntries.id, entryId));
    await db
      .update(vocabularyTranslations)
      .set({ isActive: false, updatedAt: now })
      .where(eq(vocabularyTranslations.entryId, entryId));
  },

  /**
   * Find all entries for a user with resolved source language code.
   * Used by dictionary pipeline (Task 33).
   */
  async findByUserWithSourceLang(
    userId: number,
    langResolver: (id: number) => string | undefined,
  ): Promise<VocabularyEntryWithSourceLang[]> {
    const entries = await vocabularyRepository.findByUser(userId);
    return entries
      .map((entry) => {
        const sourceLangCode = langResolver(entry.sourceLangId);
        if (!sourceLangCode) return null;
        return { ...entry, sourceLangCode };
      })
      .filter((e): e is VocabularyEntryWithSourceLang => e !== null);
  },
};

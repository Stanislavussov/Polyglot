import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "../connection.js";
import { vocabularyDictionaries, vocabularyDictionaryEntries, vocabularyEntries } from "../schema.js";

export const DEFAULT_DICTIONARY_NAME = "My Words";

export interface VocabularyDictionary {
  id: number;
  userId: number;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VocabularyDictionaryWithCount extends VocabularyDictionary {
  entryCount: number;
}

function normalizeDictionaryName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

async function attachMissingActiveEntries(userId: number, dictionaryId: number): Promise<void> {
  const db = getDb();
  const entries = await db
    .select({ id: vocabularyEntries.id })
    .from(vocabularyEntries)
    .where(and(eq(vocabularyEntries.userId, userId), eq(vocabularyEntries.isActive, true)));

  if (entries.length === 0) return;

  await db
    .insert(vocabularyDictionaryEntries)
    .values(entries.map((entry) => ({ dictionaryId, entryId: entry.id })))
    .onConflictDoNothing();
}

async function countEntries(dictionaryIds: number[]): Promise<Map<number, number>> {
  if (dictionaryIds.length === 0) return new Map();

  const db = getDb();
  const rows = await db
    .select({
      dictionaryId: vocabularyDictionaryEntries.dictionaryId,
      value: count(),
    })
    .from(vocabularyDictionaryEntries)
    .innerJoin(vocabularyEntries, eq(vocabularyDictionaryEntries.entryId, vocabularyEntries.id))
    .where(and(inArray(vocabularyDictionaryEntries.dictionaryId, dictionaryIds), eq(vocabularyEntries.isActive, true)))
    .groupBy(vocabularyDictionaryEntries.dictionaryId);

  return new Map(rows.map((row) => [row.dictionaryId, row.value]));
}

export const vocabularyDictionaryRepository = {
  normalizeName: normalizeDictionaryName,

  async getOrCreateDefault(userId: number): Promise<VocabularyDictionary> {
    const db = getDb();
    const existing = await db
      .select()
      .from(vocabularyDictionaries)
      .where(and(eq(vocabularyDictionaries.userId, userId), eq(vocabularyDictionaries.isDefault, true)))
      .limit(1);

    if (existing[0]) {
      await attachMissingActiveEntries(userId, existing[0].id);
      return existing[0];
    }

    const [created] = await db
      .insert(vocabularyDictionaries)
      .values({ userId, name: DEFAULT_DICTIONARY_NAME, isDefault: true })
      .returning();

    await attachMissingActiveEntries(userId, created!.id);
    return created!;
  },

  async listByUser(userId: number): Promise<VocabularyDictionaryWithCount[]> {
    const defaultDictionary = await vocabularyDictionaryRepository.getOrCreateDefault(userId);
    const db = getDb();
    const dictionaries = await db
      .select()
      .from(vocabularyDictionaries)
      .where(eq(vocabularyDictionaries.userId, userId))
      .orderBy(desc(vocabularyDictionaries.isDefault), desc(vocabularyDictionaries.createdAt));

    const counts = await countEntries(dictionaries.map((dictionary) => dictionary.id));
    return dictionaries.map((dictionary) => ({
      ...dictionary,
      name: dictionary.isDefault ? defaultDictionary.name : dictionary.name,
      entryCount: counts.get(dictionary.id) ?? 0,
    }));
  },

  async findOwnedById(userId: number, dictionaryId: number): Promise<VocabularyDictionary | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(vocabularyDictionaries)
      .where(and(eq(vocabularyDictionaries.id, dictionaryId), eq(vocabularyDictionaries.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  },

  async create(userId: number, name: string): Promise<VocabularyDictionary> {
    const normalized = normalizeDictionaryName(name);
    const db = getDb();
    const [created] = await db
      .insert(vocabularyDictionaries)
      .values({ userId, name: normalized, isDefault: false })
      .returning();
    return created!;
  },

  async rename(userId: number, dictionaryId: number, name: string): Promise<VocabularyDictionary | null> {
    const normalized = normalizeDictionaryName(name);
    const db = getDb();
    const updated = await db
      .update(vocabularyDictionaries)
      .set({ name: normalized, updatedAt: new Date() })
      .where(
        and(
          eq(vocabularyDictionaries.id, dictionaryId),
          eq(vocabularyDictionaries.userId, userId),
          eq(vocabularyDictionaries.isDefault, false),
        ),
      )
      .returning();
    return updated[0] ?? null;
  },

  async delete(userId: number, dictionaryId: number): Promise<boolean> {
    const db = getDb();
    const deleted = await db
      .delete(vocabularyDictionaries)
      .where(
        and(
          eq(vocabularyDictionaries.id, dictionaryId),
          eq(vocabularyDictionaries.userId, userId),
          eq(vocabularyDictionaries.isDefault, false),
        ),
      )
      .returning({ id: vocabularyDictionaries.id });
    return deleted.length > 0;
  },

  async addEntry(dictionaryId: number, entryId: number): Promise<void> {
    const db = getDb();
    await db.insert(vocabularyDictionaryEntries).values({ dictionaryId, entryId }).onConflictDoNothing();
  },

  async addEntryToDefault(userId: number, entryId: number): Promise<VocabularyDictionary> {
    const dictionary = await vocabularyDictionaryRepository.getOrCreateDefault(userId);
    await vocabularyDictionaryRepository.addEntry(dictionary.id, entryId);
    return dictionary;
  },

  async entryBelongsToDictionary(entryId: number, dictionaryId: number): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ entryId: vocabularyDictionaryEntries.entryId })
      .from(vocabularyDictionaryEntries)
      .where(
        and(
          eq(vocabularyDictionaryEntries.entryId, entryId),
          eq(vocabularyDictionaryEntries.dictionaryId, dictionaryId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  async entryBelongsToDefault(userId: number, entryId: number): Promise<boolean> {
    const dictionary = await vocabularyDictionaryRepository.getOrCreateDefault(userId);
    return vocabularyDictionaryRepository.entryBelongsToDictionary(entryId, dictionary.id);
  },

  async removeEntry(dictionaryId: number, entryId: number): Promise<number> {
    const db = getDb();
    await db
      .delete(vocabularyDictionaryEntries)
      .where(
        and(
          eq(vocabularyDictionaryEntries.dictionaryId, dictionaryId),
          eq(vocabularyDictionaryEntries.entryId, entryId),
        ),
      );

    const remaining = await db
      .select({ value: count() })
      .from(vocabularyDictionaryEntries)
      .where(eq(vocabularyDictionaryEntries.entryId, entryId));
    return remaining[0]?.value ?? 0;
  },

  async moveEntry(userId: number, fromDictionaryId: number, toDictionaryId: number, entryId: number): Promise<boolean> {
    const from = await vocabularyDictionaryRepository.findOwnedById(userId, fromDictionaryId);
    const to = await vocabularyDictionaryRepository.findOwnedById(userId, toDictionaryId);
    if (!from || !to || fromDictionaryId === toDictionaryId) return false;

    await vocabularyDictionaryRepository.addEntry(toDictionaryId, entryId);
    await vocabularyDictionaryRepository.removeEntry(fromDictionaryId, entryId);
    return true;
  },

  async listEntryDictionaries(userId: number, entryId: number): Promise<VocabularyDictionary[]> {
    const db = getDb();
    return db
      .select({
        id: vocabularyDictionaries.id,
        userId: vocabularyDictionaries.userId,
        name: vocabularyDictionaries.name,
        isDefault: vocabularyDictionaries.isDefault,
        createdAt: vocabularyDictionaries.createdAt,
        updatedAt: vocabularyDictionaries.updatedAt,
      })
      .from(vocabularyDictionaries)
      .innerJoin(vocabularyDictionaryEntries, eq(vocabularyDictionaries.id, vocabularyDictionaryEntries.dictionaryId))
      .where(and(eq(vocabularyDictionaries.userId, userId), eq(vocabularyDictionaryEntries.entryId, entryId)))
      .orderBy(desc(vocabularyDictionaries.isDefault), desc(vocabularyDictionaries.createdAt));
  },

  async listOtherDictionaries(userId: number, entryId: number): Promise<VocabularyDictionaryWithCount[]> {
    const dictionaries = await vocabularyDictionaryRepository.listByUser(userId);
    const entryDictionaries = await vocabularyDictionaryRepository.listEntryDictionaries(userId, entryId);
    const currentIds = new Set(entryDictionaries.map((dictionary) => dictionary.id));
    return dictionaries.filter((dictionary) => !currentIds.has(dictionary.id));
  },

  async hasNonDefaultDictionary(userId: number): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: vocabularyDictionaries.id })
      .from(vocabularyDictionaries)
      .where(and(eq(vocabularyDictionaries.userId, userId), ne(vocabularyDictionaries.isDefault, true)))
      .limit(1);
    return rows.length > 0;
  },
};

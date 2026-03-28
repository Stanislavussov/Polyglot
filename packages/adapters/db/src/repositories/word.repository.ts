import { and, desc, eq, ilike } from "drizzle-orm";
import { getDb } from "../index.js";
import { words } from "../schema.js";

export type Word = typeof words.$inferSelect;
export type NewWord = typeof words.$inferInsert;

export const wordRepository = {
  /** Create a new word in the dictionary. */
  async create(userId: number, word: Omit<NewWord, "userId">): Promise<Word> {
    const db = getDb();
    const rows = await db
      .insert(words)
      .values({ ...word, userId })
      .returning();
    return rows[0]!;
  },

  /** Find all words for a given user. */
  async findByUser(userId: number): Promise<Word[]> {
    const db = getDb();
    return db
      .select()
      .from(words)
      .where(and(eq(words.userId, userId), eq(words.isActive, true)))
      .orderBy(desc(words.createdAt));
  },

  /** Find a word by its ID. */
  async findById(wordId: number): Promise<Word | null> {
    const db = getDb();
    const rows = await db.select().from(words).where(eq(words.id, wordId)).limit(1);
    return rows[0] ?? null;
  },

  /** Search words by original text (case-insensitive). */
  async search(userId: number, query: string): Promise<Word[]> {
    const db = getDb();
    return db
      .select()
      .from(words)
      .where(and(eq(words.userId, userId), eq(words.isActive, true), ilike(words.original, `%${query}%`)))
      .orderBy(desc(words.createdAt));
  },

  /**
   * Update the content (translations JSONB) of a word.
   * Used after partial regeneration — caller merges the single-language
   * result into the existing content object before calling this method.
   */
  async updateContent(wordId: number, content: Record<string, unknown>): Promise<Word> {
    const db = getDb();
    const rows = await db.update(words).set({ content, updatedAt: new Date() }).where(eq(words.id, wordId)).returning();
    return rows[0]!;
  },

  /** Soft-delete a word by setting isActive to false. */
  async delete(wordId: number): Promise<void> {
    const db = getDb();
    await db.update(words).set({ isActive: false, updatedAt: new Date() }).where(eq(words.id, wordId));
  },
};

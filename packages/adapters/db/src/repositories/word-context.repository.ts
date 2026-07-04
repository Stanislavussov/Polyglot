import { and, arrayContains, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { languages, wordContext } from "../schema.js";

export type WordContext = typeof wordContext.$inferSelect;
export type NewWordContext = typeof wordContext.$inferInsert;

export const wordContextRepository = {
  /** Look up word context entries by word and language ID. */
  async findByWordAndLang(word: string, languageId: number): Promise<WordContext[]> {
    const db = getDb();
    return db
      .select()
      .from(wordContext)
      .where(and(eq(wordContext.word, word), eq(wordContext.languageId, languageId)));
  },

  /** Look up word context entries by normalized headword/expression or known form and language code. */
  async findByWordAndLangCode(word: string, langCode: string): Promise<WordContext[]> {
    const db = getDb();
    return db
      .select({
        id: wordContext.id,
        word: wordContext.word,
        languageId: wordContext.languageId,
        pos: wordContext.pos,
        forms: wordContext.forms,
        formTags: wordContext.formTags,
        glosses: wordContext.glosses,
        createdAt: wordContext.createdAt,
      })
      .from(wordContext)
      .innerJoin(languages, eq(wordContext.languageId, languages.id))
      .where(
        and(
          or(sql`lower(${wordContext.word}) = lower(${word})`, arrayContains(wordContext.forms, [word])),
          eq(languages.code, langCode),
        ),
      );
  },

  /**
   * Distinct supported-language codes whose dictionary contains the word
   * (as headword/expression or known form), best coverage first.
   * Powers single-word language detection across the whole supported set.
   */
  async findLanguageCodesByWord(word: string): Promise<{ code: string; entryCount: number }[]> {
    const db = getDb();
    return db
      .select({ code: languages.code, entryCount: sql<number>`count(*)::int` })
      .from(wordContext)
      .innerJoin(languages, eq(wordContext.languageId, languages.id))
      .where(
        and(
          or(sql`lower(${wordContext.word}) = lower(${word})`, arrayContains(wordContext.forms, [word])),
          eq(languages.isSupported, true),
        ),
      )
      .groupBy(languages.code)
      .orderBy(sql`count(*) desc`);
  },

  /**
   * Search word context entries by partial word match (case-insensitive).
   * Searches within a specific language by ID.
   */
  async search(query: string, languageId: number, limit: number = 20): Promise<WordContext[]> {
    const db = getDb();
    return db
      .select()
      .from(wordContext)
      .where(and(ilike(wordContext.word, `%${query}%`), eq(wordContext.languageId, languageId)))
      .limit(limit);
  },

  /** Bulk insert word context entries. Returns the number of rows inserted. */
  async createBatch(entries: NewWordContext[]): Promise<number> {
    if (entries.length === 0) return 0;
    const db = getDb();
    const result = await db.insert(wordContext).values(entries).returning();
    return result.length;
  },

  /** Count entries by language ID. */
  async countByLanguage(languageId: number): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(wordContext)
      .where(eq(wordContext.languageId, languageId));
    if (rows.length === 0) return 0;
    return rows[0].count;
  },

  /** Find a single entry by its ID. */
  async findById(id: number): Promise<WordContext | null> {
    const db = getDb();
    const rows = await db.select().from(wordContext).where(eq(wordContext.id, id)).limit(1);
    return rows[0] ?? null;
  },
};

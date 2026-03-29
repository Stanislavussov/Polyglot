import { and, desc, eq, ilike } from "drizzle-orm";
import type {
  CefrLevel,
  Example,
  ExpressionType,
  Register,
  Synonym,
  TranslationVariant,
} from "@polyglot/core";
import { getDb } from "../connection.js";
import { words } from "../schema.js";

export type Word = typeof words.$inferSelect;
export type NewWord = typeof words.$inferInsert;

/* ------------------------------------------------------------------ */
/*  StoredWordContent — typed JSONB shape for words.content            */
/* ------------------------------------------------------------------ */

/** Translation data for a single target language, as stored in the DB. */
export interface StoredLanguageTranslation {
  text: string;
  cefr: CefrLevel;
  transcription?: string;
  register: Register;
  synonyms: Synonym[];
  examples: Example[];
  alternatives?: TranslationVariant[];
  expressionType?: ExpressionType;
  equivalentNote?: string;
  /** Optional connotation warning for dangerous/misleading meanings (Task 31). */
  connotationWarning?: string;
}

/** JSONB content for words.content — emoji + register + per-language translations. */
export interface StoredWordContent {
  emoji: string;
  register: Register;
  translations: Record<string, StoredLanguageTranslation>;
}

/* ------------------------------------------------------------------ */
/*  CreateWordInput — typed input for wordRepository.create()          */
/* ------------------------------------------------------------------ */

export interface CreateWordInput {
  original: string;
  sourceLangId: number;
  inputType: "word" | "phrase";
  content: StoredWordContent;
}

/* ------------------------------------------------------------------ */
/*  Repository                                                         */
/* ------------------------------------------------------------------ */

export const wordRepository = {
  /** Create a new word in the dictionary. */
  async create(userId: number, input: CreateWordInput): Promise<Word> {
    const db = getDb();
    const rows = await db
      .insert(words)
      .values({
        userId,
        original: input.original,
        sourceLangId: input.sourceLangId,
        inputType: input.inputType,
        content: input.content,
      })
      .returning();
    return rows[0]!;
  },

  /**
   * Find a word by (userId, original, sourceLangId) — duplicate detection.
   * Uses the unique index for efficient lookup.
   * Returns null when no entry found.
   */
  async findByOriginalAndSource(
    userId: number,
    original: string,
    sourceLangId: number,
  ): Promise<Word | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(words)
      .where(
        and(
          eq(words.userId, userId),
          eq(words.original, original),
          eq(words.sourceLangId, sourceLangId),
          eq(words.isActive, true),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
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
  async updateContent(wordId: number, content: StoredWordContent): Promise<Word> {
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

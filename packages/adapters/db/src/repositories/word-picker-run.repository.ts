import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../connection.js";
import type { WordPickerItem, WordPickerRun } from "../schema.js";
import { wordPickerItems, wordPickerRuns } from "../schema.js";

export type { WordPickerItem, WordPickerRun };

export interface CreateWordPickerRunInput {
  userId: number;
  presetId: number;
  presetTitle: string;
  presetEmoji: string;
  langCode: string;
  nativeLang: string;
}

export interface WordPickerItemInput {
  word: string;
  nativeTranslation: string;
  emoji: string | null;
  itemType: string | null;
  level: string | null;
  exampleTarget: string | null;
  exampleNative: string | null;
  note: string | null;
}

export const wordPickerRunRepository = {
  async createRun(input: CreateWordPickerRunInput): Promise<WordPickerRun> {
    const db = getDb();
    const rows = await db.insert(wordPickerRuns).values(input).returning();
    return rows[0]!;
  },

  async saveItems(runId: number, items: WordPickerItemInput[]): Promise<WordPickerItem[]> {
    if (items.length === 0) return [];
    const db = getDb();
    return db
      .insert(wordPickerItems)
      .values(items.map((item, index) => ({ ...item, runId, sortOrder: index + 1 })))
      .returning();
  },

  async findRunById(runId: number): Promise<WordPickerRun | null> {
    const db = getDb();
    const rows = await db.select().from(wordPickerRuns).where(eq(wordPickerRuns.id, runId)).limit(1);
    return rows[0] ?? null;
  },

  async findItemsByRun(runId: number): Promise<WordPickerItem[]> {
    const db = getDb();
    return db
      .select()
      .from(wordPickerItems)
      .where(eq(wordPickerItems.runId, runId))
      .orderBy(asc(wordPickerItems.sortOrder));
  },

  async findItemById(itemId: number): Promise<WordPickerItem | null> {
    const db = getDb();
    const rows = await db.select().from(wordPickerItems).where(eq(wordPickerItems.id, itemId)).limit(1);
    return rows[0] ?? null;
  },

  async findUnsavedItemsByRun(runId: number): Promise<WordPickerItem[]> {
    const db = getDb();
    return db
      .select()
      .from(wordPickerItems)
      .where(and(eq(wordPickerItems.runId, runId), isNull(wordPickerItems.savedEntryId)))
      .orderBy(asc(wordPickerItems.sortOrder));
  },

  async markItemSaved(itemId: number, entryId: number): Promise<void> {
    const db = getDb();
    await db.update(wordPickerItems).set({ savedEntryId: entryId }).where(eq(wordPickerItems.id, itemId));
  },

  /**
   * Every word this user has already been shown for this angle and language.
   *
   * Feeds the "do not pick these again" list, which is what makes the "more"
   * button worth pressing: without it the model returns the same obvious eight
   * words every time.
   */
  async findWordsShownTo(userId: number, presetId: number, langCode: string, limit = 300): Promise<string[]> {
    const db = getDb();
    const runs = await db
      .select({ id: wordPickerRuns.id })
      .from(wordPickerRuns)
      .where(
        and(
          eq(wordPickerRuns.userId, userId),
          eq(wordPickerRuns.presetId, presetId),
          eq(wordPickerRuns.langCode, langCode),
        ),
      )
      .orderBy(desc(wordPickerRuns.createdAt))
      .limit(50);

    if (runs.length === 0) return [];

    const rows = await db
      .select({ word: wordPickerItems.word })
      .from(wordPickerItems)
      .where(
        inArray(
          wordPickerItems.runId,
          runs.map((run) => run.id),
        ),
      )
      .limit(limit);

    return rows.map((row) => row.word);
  },
};

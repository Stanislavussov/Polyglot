import { and, arrayOverlaps, asc, eq, or, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import type { WordPickerPreset } from "../schema.js";
import { wordPickerPresets } from "../schema.js";

export type { WordPickerPreset };

export interface WordPickerPresetInput {
  slug: string;
  emoji: string;
  title: string;
  titleI18n: Record<string, string>;
  prompt: string;
  learningLangs: string[];
  sortOrder: number;
  isActive: boolean;
}

export const wordPickerPresetRepository = {
  async findAll(): Promise<WordPickerPreset[]> {
    const db = getDb();
    return db.select().from(wordPickerPresets).orderBy(asc(wordPickerPresets.sortOrder), asc(wordPickerPresets.id));
  },

  async findById(id: number): Promise<WordPickerPreset | null> {
    const db = getDb();
    const rows = await db.select().from(wordPickerPresets).where(eq(wordPickerPresets.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async findBySlug(slug: string): Promise<WordPickerPreset | null> {
    const db = getDb();
    const rows = await db.select().from(wordPickerPresets).where(eq(wordPickerPresets.slug, slug)).limit(1);
    return rows[0] ?? null;
  },

  /**
   * Active presets offered for any of `langCodes` — those scoped to one of them
   * plus the unscoped ones (an empty `learning_langs` means every language).
   */
  async findActiveForLangs(langCodes: string[]): Promise<WordPickerPreset[]> {
    const db = getDb();
    const scoped = langCodes.length > 0 ? arrayOverlaps(wordPickerPresets.learningLangs, langCodes) : sql`false`;
    return db
      .select()
      .from(wordPickerPresets)
      .where(
        and(eq(wordPickerPresets.isActive, true), or(sql`cardinality(${wordPickerPresets.learningLangs}) = 0`, scoped)),
      )
      .orderBy(asc(wordPickerPresets.sortOrder), asc(wordPickerPresets.id));
  },

  async create(input: WordPickerPresetInput): Promise<WordPickerPreset> {
    const db = getDb();
    const rows = await db.insert(wordPickerPresets).values(input).returning();
    return rows[0]!;
  },

  async update(id: number, input: WordPickerPresetInput): Promise<WordPickerPreset> {
    const db = getDb();
    const rows = await db
      .update(wordPickerPresets)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(wordPickerPresets.id, id))
      .returning();
    return rows[0]!;
  },

  /** Insert only when the slug is absent — the seeder never overwrites an edited preset. */
  async insertIfMissing(input: WordPickerPresetInput): Promise<boolean> {
    const db = getDb();
    const rows = await db.insert(wordPickerPresets).values(input).onConflictDoNothing().returning();
    return rows.length > 0;
  },

  async delete(id: number): Promise<void> {
    const db = getDb();
    await db.delete(wordPickerPresets).where(eq(wordPickerPresets.id, id));
  },
};

import { eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import type { TranslationPreset } from "../schema.js";
import { translationPresets } from "../schema.js";

export type { TranslationPreset };

export type PresetConfig = {
  synonyms: boolean;
  examples: boolean;
  alternatives: boolean;
  equivalentNote: boolean;
  connotationWarning: boolean;
};

export const translationPresetRepository = {
  async findAll(): Promise<TranslationPreset[]> {
    const db = getDb();
    return db.select().from(translationPresets).orderBy(translationPresets.name);
  },

  async findByName(name: string): Promise<TranslationPreset | null> {
    const db = getDb();
    const rows = await db.select().from(translationPresets).where(eq(translationPresets.name, name)).limit(1);
    return rows[0] ?? null;
  },

  async upsert(data: {
    name: string;
    label: string;
    config: PresetConfig;
    isActive?: boolean;
  }): Promise<TranslationPreset> {
    const db = getDb();
    const rows = await db
      .insert(translationPresets)
      .values({ ...data, isActive: data.isActive ?? true, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: translationPresets.name,
        set: { label: data.label, config: data.config, isActive: data.isActive ?? true, updatedAt: new Date() },
      })
      .returning();
    return rows[0]!;
  },

  async delete(name: string): Promise<void> {
    const db = getDb();
    await db.delete(translationPresets).where(eq(translationPresets.name, name));
  },
};

import type { TemplateFields } from "@polyglot/core";
import { eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { userTranslationTemplates } from "../schema.js";

/* ------------------------------------------------------------------ */
/*  SavedTranslationTemplate — row type returned by repository         */
/* ------------------------------------------------------------------ */

export interface SavedTranslationTemplate {
  id: number;
  userId: number;
  name: string;
  fields: TemplateFields;
  createdAt: Date;
  updatedAt: Date;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Map a DB row (individual boolean columns) to SavedTranslationTemplate */
function toSavedTemplate(row: typeof userTranslationTemplates.$inferSelect): SavedTranslationTemplate {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    fields: {
      synonyms: row.synonyms,
      examples: row.examples,
      alternatives: row.alternatives,
      equivalentNote: row.equivalentNote,
      connotationWarning: row.connotationWarning,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/*  Repository                                                         */
/* ------------------------------------------------------------------ */

export const translationTemplateRepository = {
  /**
   * Get the user's custom template, or null if they haven't set one.
   * When null, the caller should fall back to DEFAULT_TEMPLATE.
   */
  async getByUserId(userId: number): Promise<SavedTranslationTemplate | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userTranslationTemplates)
      .where(eq(userTranslationTemplates.userId, userId))
      .limit(1);
    return rows[0] ? toSavedTemplate(rows[0]) : null;
  },

  /**
   * Upsert the user's template.
   * Creates if not exists, updates if exists.
   */
  async upsert(userId: number, name: string, fields: TemplateFields): Promise<SavedTranslationTemplate> {
    const db = getDb();
    const rows = await db
      .insert(userTranslationTemplates)
      .values({
        userId,
        name,
        synonyms: fields.synonyms,
        examples: fields.examples,
        alternatives: fields.alternatives,
        equivalentNote: fields.equivalentNote,
        connotationWarning: fields.connotationWarning,
      })
      .onConflictDoUpdate({
        target: userTranslationTemplates.userId,
        set: {
          name,
          synonyms: fields.synonyms,
          examples: fields.examples,
          alternatives: fields.alternatives,
          equivalentNote: fields.equivalentNote,
          connotationWarning: fields.connotationWarning,
          updatedAt: new Date(),
        },
      })
      .returning();
    return toSavedTemplate(rows[0]!);
  },

  /**
   * Delete the user's custom template (reset to default).
   */
  async deleteByUserId(userId: number): Promise<void> {
    const db = getDb();
    await db.delete(userTranslationTemplates).where(eq(userTranslationTemplates.userId, userId));
  },
};

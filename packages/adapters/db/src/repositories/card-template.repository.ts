import { type CardFrontFields, DEFAULT_CARD_FRONT_FIELDS } from "@polyglot/core";
import { eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { userCardTemplates } from "../schema.js";

const COLUMN_OF = {
  synonyms: "showSynonyms",
  example: "showExample",
  hint: "showHint",
} as const satisfies Record<keyof CardFrontFields, keyof typeof userCardTemplates.$inferInsert>;

function toFields(row: typeof userCardTemplates.$inferSelect): CardFrontFields {
  return { synonyms: row.showSynonyms, example: row.showExample, hint: row.showHint };
}

export const cardTemplateRepository = {
  async getFields(userId: number): Promise<CardFrontFields> {
    const db = getDb();
    const rows = await db.select().from(userCardTemplates).where(eq(userCardTemplates.userId, userId)).limit(1);
    return rows[0] ? toFields(rows[0]) : { ...DEFAULT_CARD_FRONT_FIELDS };
  },

  /**
   * Upsert one toggle. The first write seeds the other columns from the core
   * defaults explicitly rather than from the column defaults, so the two can
   * never disagree about what an untouched user was seeing.
   */
  async setField(userId: number, field: keyof CardFrontFields, enabled: boolean): Promise<CardFrontFields> {
    const db = getDb();
    const column = COLUMN_OF[field];
    const [row] = await db
      .insert(userCardTemplates)
      .values({
        userId,
        showSynonyms: DEFAULT_CARD_FRONT_FIELDS.synonyms,
        showExample: DEFAULT_CARD_FRONT_FIELDS.example,
        showHint: DEFAULT_CARD_FRONT_FIELDS.hint,
        [column]: enabled,
      })
      .onConflictDoUpdate({
        target: userCardTemplates.userId,
        set: { [column]: enabled, updatedAt: new Date() },
      })
      .returning();
    return toFields(row!);
  },
};

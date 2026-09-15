import { DEFAULT_NOTIFICATION_TEMPLATE_FIELDS, type NotificationTemplateFields } from "@polyglot/core";
import { eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { userNotificationTemplates } from "../schema.js";

const COLUMN_OF = {
  synonyms: "showSynonyms",
} as const satisfies Record<keyof NotificationTemplateFields, keyof typeof userNotificationTemplates.$inferInsert>;

function toFields(row: typeof userNotificationTemplates.$inferSelect): NotificationTemplateFields {
  return { synonyms: row.showSynonyms };
}

export const notificationTemplateRepository = {
  async getFields(userId: number): Promise<NotificationTemplateFields> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userNotificationTemplates)
      .where(eq(userNotificationTemplates.userId, userId))
      .limit(1);
    return rows[0] ? toFields(rows[0]) : { ...DEFAULT_NOTIFICATION_TEMPLATE_FIELDS };
  },

  /** Upsert one toggle; the first write seeds the other columns from the core defaults, as the card template does. */
  async setField(
    userId: number,
    field: keyof NotificationTemplateFields,
    enabled: boolean,
  ): Promise<NotificationTemplateFields> {
    const db = getDb();
    const column = COLUMN_OF[field];
    const values: typeof userNotificationTemplates.$inferInsert = {
      userId,
      showSynonyms: DEFAULT_NOTIFICATION_TEMPLATE_FIELDS.synonyms,
    };
    // Assigned, not a computed key in the literal: with one field tsc resolves `[column]` to a duplicate property.
    values[column] = enabled;
    const [row] = await db
      .insert(userNotificationTemplates)
      .values(values)
      .onConflictDoUpdate({
        target: userNotificationTemplates.userId,
        set: { [column]: enabled, updatedAt: new Date() },
      })
      .returning();
    return toFields(row!);
  },
};

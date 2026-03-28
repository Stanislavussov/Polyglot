import { and, eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { topicTranslationCache } from "../schema.js";

export type TopicTranslation = typeof topicTranslationCache.$inferSelect;
export type NewTopicTranslation = typeof topicTranslationCache.$inferInsert;

export const topicRepository = {
  /** Get a cached translation for a topic word. Returns null if not found or invalid. */
  async getCached(
    topicId: string,
    original: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<TopicTranslation | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(topicTranslationCache)
      .where(
        and(
          eq(topicTranslationCache.topicId, topicId),
          eq(topicTranslationCache.original, original),
          eq(topicTranslationCache.sourceLang, sourceLang),
          eq(topicTranslationCache.targetLang, targetLang),
          eq(topicTranslationCache.isValid, true),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  /** Store a translated topic word in cache (upsert). */
  async setCached(data: NewTopicTranslation): Promise<TopicTranslation> {
    const db = getDb();
    const rows = await db
      .insert(topicTranslationCache)
      .values(data)
      .onConflictDoUpdate({
        target: [
          topicTranslationCache.topicId,
          topicTranslationCache.original,
          topicTranslationCache.sourceLang,
          topicTranslationCache.targetLang,
        ],
        set: {
          content: data.content,
          isValid: true,
          invalidReason: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0]!;
  },

  /** Mark a cached translation as invalid (stale). */
  async markInvalid(id: number, reason: string): Promise<void> {
    const db = getDb();
    await db
      .update(topicTranslationCache)
      .set({
        isValid: false,
        invalidReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(topicTranslationCache.id, id));
  },
};

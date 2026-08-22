import type { TtsCacheHit, TtsCacheKey, TtsCacheRepository } from "@polyglot/core";
import { hashTtsText } from "@polyglot/core";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { ttsCache } from "../schema.js";

/** The composite key predicate, shared by lookup and conflict handling. */
function keyPredicate(key: TtsCacheKey) {
  return and(
    eq(ttsCache.textHash, hashTtsText(key.text)),
    eq(ttsCache.langCode, key.langCode),
    eq(ttsCache.modelId, key.modelId),
    eq(ttsCache.voice, key.voice),
  );
}

export const ttsCacheRepository: TtsCacheRepository = {
  async find(key: TtsCacheKey): Promise<TtsCacheHit | null> {
    const db = getDb();
    const rows = await db
      .select({ id: ttsCache.id, telegramFileId: ttsCache.telegramFileId })
      .from(ttsCache)
      .where(keyPredicate(key))
      .limit(1);
    return rows[0] ?? null;
  },

  async save(entry: TtsCacheKey & { telegramFileId: string; charCount: number }): Promise<void> {
    const db = getDb();
    // Concurrent first taps on the same word race here. Losing the race costs one
    // redundant synthesis that is already paid for; it must not throw at the caller,
    // who has already delivered the audio.
    await db
      .insert(ttsCache)
      .values({
        textHash: hashTtsText(entry.text),
        text: entry.text,
        langCode: entry.langCode,
        modelId: entry.modelId,
        voice: entry.voice,
        telegramFileId: entry.telegramFileId,
        charCount: entry.charCount,
      })
      .onConflictDoNothing();
  },

  async touch(id: number): Promise<void> {
    const db = getDb();
    await db
      .update(ttsCache)
      .set({ useCount: sql`${ttsCache.useCount} + 1`, lastUsedAt: new Date() })
      .where(eq(ttsCache.id, id));
  },

  async remove(id: number): Promise<void> {
    const db = getDb();
    await db.delete(ttsCache).where(eq(ttsCache.id, id));
  },
};

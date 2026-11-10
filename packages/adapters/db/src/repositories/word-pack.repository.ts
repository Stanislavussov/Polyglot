import type {
  ActiveWordPackItem,
  LocalizedPackWord,
  PublishWordPackInput,
  WordPack,
  WordPackRepository,
} from "@polyglot/core";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { wordPackItems, wordPacks } from "../schema.js";

const dictionarySlug = (dictionaryId: number): string => `dict-${dictionaryId}`;

export const wordPackRepository: WordPackRepository = {
  async publishFromDictionary(input: PublishWordPackInput): Promise<WordPack> {
    const db = getDb();
    const rows = await db
      .insert(wordPacks)
      .values({
        slug: dictionarySlug(input.dictionaryId),
        title: input.title,
        emoji: input.emoji,
        sourceDictionaryId: input.dictionaryId,
        createdByUserId: input.createdByUserId,
      })
      // The title follows the dictionary; `is_active` and edited translations of
      // the title belong to the editor and are left alone.
      .onConflictDoUpdate({ target: wordPacks.slug, set: { title: input.title, updatedAt: new Date() } })
      .returning();
    return rows[0]!;
  },

  async upsertItems(packId: number, items: LocalizedPackWord[]): Promise<void> {
    if (items.length === 0) return;
    const db = getDb();
    await db
      .insert(wordPackItems)
      .values(
        items.map((item) => ({
          packId,
          sourceLang: item.sourceLang,
          sourceHeadword: item.sourceHeadword,
          level: item.level,
          emoji: item.emoji,
          headwords: item.headwords,
        })),
      )
      .onConflictDoUpdate({
        target: [wordPackItems.packId, wordPackItems.sourceLang, wordPackItems.sourceHeadword],
        // Not `is_active`: an editor's "switch this word off" must survive a republish.
        set: {
          level: sql`excluded.level`,
          emoji: sql`excluded.emoji`,
          headwords: sql`excluded.headwords`,
          updatedAt: new Date(),
        },
      });
  },

  async countActiveItems(packId: number): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ value: count() })
      .from(wordPackItems)
      .where(and(eq(wordPackItems.packId, packId), eq(wordPackItems.isActive, true)));
    return rows[0]?.value ?? 0;
  },

  async findActiveItems(): Promise<ActiveWordPackItem[]> {
    const db = getDb();
    return db
      .select({
        itemId: wordPackItems.id,
        packId: wordPacks.id,
        packEmoji: wordPacks.emoji,
        packTitle: wordPacks.title,
        packTitleI18n: wordPacks.titleI18n,
        sourceLang: wordPackItems.sourceLang,
        sourceHeadword: wordPackItems.sourceHeadword,
        level: wordPackItems.level,
        emoji: wordPackItems.emoji,
        headwords: wordPackItems.headwords,
      })
      .from(wordPackItems)
      .innerJoin(wordPacks, eq(wordPacks.id, wordPackItems.packId))
      .where(and(eq(wordPacks.isActive, true), eq(wordPackItems.isActive, true)))
      .orderBy(asc(wordPackItems.id));
  },
};

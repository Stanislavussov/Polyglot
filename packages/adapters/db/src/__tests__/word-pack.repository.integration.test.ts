/**
 * Word-pack persistence (Task 87) — real-DB integration tests.
 *
 * What the re-engagement sweep relies on: republishing a dictionary updates its
 * one pack instead of piling up copies, a word the editor switched off stays off
 * across republishes, and nothing switched off is ever served. `findActiveItems`
 * reads every pack in the shared database, so assertions are narrowed to this
 * test's own pack.
 */
import type { LocalizedPackWord } from "@polyglot/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { wordPackRepository } from "../repositories/word-pack.repository.js";
import { users, vocabularyDictionaries, wordPackItems, wordPacks } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

async function seedDictionary(): Promise<{ userId: number; dictionaryId: number }> {
  const db = getDb();
  const [user] = await db
    .insert(users)
    .values({ telegramId: uniqueTelegramId(), onboarded: true, onboardingStep: 4, isActive: true })
    .returning();
  const [dictionary] = await db
    .insert(vocabularyDictionaries)
    .values({ userId: user!.id, name: "Standard 55" })
    .returning();
  return { userId: user!.id, dictionaryId: dictionary!.id };
}

function word(sourceHeadword: string, overrides: Partial<LocalizedPackWord> = {}): LocalizedPackWord {
  return {
    sourceLang: "en",
    sourceHeadword,
    level: "C1",
    emoji: "✨",
    headwords: { en: sourceHeadword, de: `${sourceHeadword}-de` },
    ...overrides,
  };
}

async function servedWords(packId: number): Promise<string[]> {
  const items = await wordPackRepository.findActiveItems();
  return items
    .filter((item) => item.packId === packId)
    .map((item) => item.sourceHeadword)
    .sort();
}

describe("wordPackRepository", () => {
  it("keeps one pack per dictionary, retitled when it is published again", async () => {
    const { userId, dictionaryId } = await seedDictionary();

    const first = await wordPackRepository.publishFromDictionary({
      dictionaryId,
      createdByUserId: userId,
      title: "Standard 55",
      emoji: "📦",
    });
    const second = await wordPackRepository.publishFromDictionary({
      dictionaryId,
      createdByUserId: userId,
      title: "Standard 56",
      emoji: "📦",
    });

    expect(second.id).toBe(first.id);
    expect(second.title).toBe("Standard 56");
    expect(second.sourceDictionaryId).toBe(dictionaryId);
  });

  it("refreshes known words and adds new ones, but a word switched off by hand stays off", async () => {
    const { userId, dictionaryId } = await seedDictionary();
    const pack = await wordPackRepository.publishFromDictionary({
      dictionaryId,
      createdByUserId: userId,
      title: "Pack",
      emoji: "📦",
    });
    await wordPackRepository.upsertItems(pack.id, [word("petrichor"), word("wanderlust")]);
    await getDb().update(wordPackItems).set({ isActive: false }).where(eq(wordPackItems.sourceHeadword, "wanderlust"));

    await wordPackRepository.upsertItems(pack.id, [
      word("petrichor", { level: "C2", headwords: { en: "petrichor", es: "olor a lluvia" } }),
      word("wanderlust"),
      word("saudade"),
    ]);

    expect(await servedWords(pack.id)).toEqual(["petrichor", "saudade"]);
    expect(await wordPackRepository.countActiveItems(pack.id)).toBe(2);
    const petrichor = (await wordPackRepository.findActiveItems()).find(
      (item) => item.packId === pack.id && item.sourceHeadword === "petrichor",
    );
    expect(petrichor).toMatchObject({ level: "C2", headwords: { en: "petrichor", es: "olor a lluvia" } });
  });

  it("serves nothing from a pack that is switched off", async () => {
    const { userId, dictionaryId } = await seedDictionary();
    const pack = await wordPackRepository.publishFromDictionary({
      dictionaryId,
      createdByUserId: userId,
      title: "Pack",
      emoji: "📦",
    });
    await wordPackRepository.upsertItems(pack.id, [word("petrichor")]);
    expect(await servedWords(pack.id)).toEqual(["petrichor"]);

    await getDb().update(wordPacks).set({ isActive: false }).where(eq(wordPacks.id, pack.id));

    expect(await servedWords(pack.id)).toEqual([]);
  });
});

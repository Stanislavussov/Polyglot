/**
 * Practice-ahead cards — real-DB integration test (Task 85).
 *
 * When fewer cards are due than a Cards session holds, the deck is topped up with
 * not-yet-due rows, weakest first. The ordering is a SQL expression over two joined
 * tables, so only Postgres can prove it.
 */
import { describe, expect, it } from "vitest";
import { languageRepository } from "../repositories/language.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import { vocabularyRepository } from "../repositories/vocabulary.repository.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

const NOW = new Date("2026-02-10T09:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

async function freshUserId(): Promise<number> {
  const user = await userRepository.create({ telegramId: uniqueTelegramId(), username: "srs-ahead-test" });
  return user.id;
}

async function langId(code: string): Promise<number> {
  const lang = await languageRepository.findByCode(code);
  if (!lang) throw new Error(`Expected seeded language '${code}' to exist on the migrated branch`);
  return lang.id;
}

describe("vocabularyRepository.findAheadForSrs (integration)", () => {
  it("returns only not-yet-due live cards: hard entries first, then lowest ease, then soonest due", async () => {
    const userId = await freshUserId();
    const de = await langId("de");
    const ru = await langId("ru");

    const seed = async (original: string, easeFactor: number, dueInDays: number) => {
      const entry = await vocabularyRepository.create(userId, {
        original,
        sourceLangId: de,
        inputType: "word",
        translations: [{ targetLangId: ru, text: `${original}-ru`, details: { synonyms: [], examples: [] } }],
      });
      await vocabularyRepository.updateSrsState(entry.translations[0]!.id, {
        easeFactor,
        interval: 6,
        dueDate: new Date(NOW.getTime() + dueInDays * DAY_MS),
        reviewCount: 2,
      });
      return entry.id;
    };

    await seed("Fällig", 1.3, -1);
    await seed("Leicht", 2.5, 3);
    await seed("Zäh", 1.8, 10);
    const hard = await seed("Schwer", 2.5, 20);
    await vocabularyRepository.setDifficulty(hard, userId, "hard");
    await seed("Zäh-bald", 1.8, 5);
    const removed = await seed("Weg", 1.3, 1);
    await vocabularyRepository.delete(removed, userId);

    const ahead = await vocabularyRepository.findAheadForSrs(userId, NOW, 10);

    expect(ahead.map((card) => card.original)).toEqual(["Schwer", "Zäh-bald", "Zäh", "Leicht"]);
    expect(await vocabularyRepository.findAheadForSrs(userId, NOW, 2)).toHaveLength(2);
  });
});

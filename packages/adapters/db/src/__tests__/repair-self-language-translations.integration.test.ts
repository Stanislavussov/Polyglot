/**
 * The one-off repair that deletes translation rows stored in their entry's own
 * language (`self-language-translation-repair.ts`, driven from `deploy.yml`).
 *
 * It deletes from a production dictionary, so what it removes and what it leaves
 * alone are asserted against a real Postgres before it is ever run: it must take
 * only the same-language rows, keep every real translation of the same entry, and
 * be safe to run twice.
 *
 * The repair is global and the lane runs files in parallel, so every assertion is
 * scoped to this test's own entry rather than to a row count.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { languageRepository } from "../repositories/language.repository.js";
import { deleteSelfLanguageTranslations } from "../repositories/self-language-translation-repair.js";
import { userRepository } from "../repositories/user.repository.js";
import { vocabularyRepository } from "../repositories/vocabulary.repository.js";
import { vocabularyTranslations } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

async function langId(code: string): Promise<number> {
  const lang = await languageRepository.findByCode(code);
  if (!lang) throw new Error(`Expected seeded language '${code}' to exist on the migrated branch`);
  return lang.id;
}

/** A ru-native learner of cs+en, as the reported incident had it. */
async function arrangeLearner(): Promise<number> {
  const user = await userRepository.create({ telegramId: uniqueTelegramId(), username: "self-lang-repair-test" });
  await userRepository.updateSettings(user.id, {
    interfaceLang: "ru",
    nativeLang: "ru",
    learningLangs: ["cs", "en"],
    lastSourceLang: null,
  });
  return user.id;
}

/**
 * A Czech word carrying the Czech paraphrase the notification's just-in-time
 * translation used to store beside the real Russian answer.
 */
async function arrangeDamagedEntry(userId: number): Promise<number> {
  const entry = await vocabularyRepository.create(userId, {
    original: "Povzdech ulevy",
    sourceLangId: await langId("cs"),
    inputType: "phrase",
    translations: [
      { targetLangId: await langId("ru"), text: "вздох облегчения", details: { synonyms: [], examples: [] } },
      { targetLangId: await langId("cs"), text: "Povzdech úlevy", details: { synonyms: [], examples: [] } },
    ],
  });
  return entry.id;
}

async function translationLangsOf(entryId: number): Promise<number[]> {
  const rows = await getDb()
    .select({ targetLangId: vocabularyTranslations.targetLangId })
    .from(vocabularyTranslations)
    .where(eq(vocabularyTranslations.entryId, entryId));
  return rows.map((row) => row.targetLangId).sort((a, b) => a - b);
}

describe("repair-self-language-translations (integration)", () => {
  it("deletes the row in the entry's own language and keeps the real translation", async () => {
    const userId = await arrangeLearner();
    const entryId = await arrangeDamagedEntry(userId);
    expect(await translationLangsOf(entryId)).toEqual([await langId("ru"), await langId("cs")].sort((a, b) => a - b));

    const deleted = await deleteSelfLanguageTranslations();

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await translationLangsOf(entryId)).toEqual([await langId("ru")]);
  });

  it("leaves an entry that has no same-language row completely untouched", async () => {
    const userId = await arrangeLearner();
    const healthy = await vocabularyRepository.create(userId, {
      original: "borůvky",
      sourceLangId: await langId("cs"),
      inputType: "word",
      translations: [
        { targetLangId: await langId("ru"), text: "черника", details: { synonyms: [], examples: [] } },
        { targetLangId: await langId("en"), text: "blueberries", details: { synonyms: [], examples: [] } },
      ],
    });
    const before = await translationLangsOf(healthy.id);

    await deleteSelfLanguageTranslations();

    expect(await translationLangsOf(healthy.id)).toEqual(before);
  });

  it("is a no-op on a second run", async () => {
    const userId = await arrangeLearner();
    const entryId = await arrangeDamagedEntry(userId);

    await deleteSelfLanguageTranslations();
    const survivor = (await vocabularyRepository.findById(entryId))?.translations[0];
    expect(survivor?.text).toBe("вздох облегчения");

    // Re-run: the predicate no longer matches this entry, so the deploy can carry
    // the repair for as many releases as it takes without eating the real answer.
    await deleteSelfLanguageTranslations();

    const after = (await vocabularyRepository.findById(entryId))?.translations;
    expect(after).toHaveLength(1);
    expect(after?.[0]?.id).toBe(survivor?.id);
  });
});

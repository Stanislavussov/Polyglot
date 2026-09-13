/**
 * The one-off repair for entries whose native translation background enrichment
 * deleted (`native-translation-repair.ts`, driven by `pnpm repair:native-translations`).
 *
 * It writes to a production dictionary, so what it selects and what it leaves
 * alone are asserted against a real Postgres before it is ever run: it must find
 * only entries the bug could have damaged, take the text verbatim off the row the
 * save came from, invent nothing, and be safe to run twice.
 */
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { languageRepository } from "../repositories/language.repository.js";
import {
  findRepairableNativeTranslations,
  restoreNativeTranslations,
} from "../repositories/native-translation-repair.js";
import { userRepository } from "../repositories/user.repository.js";
import { vocabularyRepository } from "../repositories/vocabulary.repository.js";
import { videoPhrases, videoProcesses, vocabularyTranslations } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

async function langId(code: string): Promise<number> {
  const lang = await languageRepository.findByCode(code);
  if (!lang) throw new Error(`Expected seeded language '${code}' to exist on the migrated branch`);
  return lang.id;
}

/** A ru-native learner of cs+en, as the reported incident had it. */
async function arrangeLearner(): Promise<number> {
  const user = await userRepository.create({ telegramId: uniqueTelegramId(), username: "repair-test" });
  await userRepository.updateSettings(user.id, {
    interfaceLang: "ru",
    nativeLang: "ru",
    learningLangs: ["cs", "en"],
    lastSourceLang: null,
  });
  return user.id;
}

/**
 * An English phrase saved from a video and then stripped of its Russian row by
 * the enrichment — the damaged shape, built the way it was really produced.
 */
async function arrangeDamagedVideoEntry(
  userId: number,
  phrase: string,
  nativeTranslation: string,
  options: { keepNative?: boolean } = {},
): Promise<number> {
  const db = getDb();
  const [process] = await db
    .insert(videoProcesses)
    .values({
      userId,
      videoId: `vid${uniqueTelegramId()}`.slice(0, 11),
      videoUrl: "https://youtu.be/x",
      language: "en",
      status: "completed",
    })
    .returning();

  const entry = await vocabularyRepository.create(userId, {
    original: phrase,
    sourceLangId: await langId("en"),
    inputType: "phrase",
    emoji: "🤔",
    nativeMeaning: "a paragraph of description where the answer belongs",
    source: { type: "video", videoUrl: "https://youtu.be/x", videoTitle: "clip", timestampSeconds: 1 },
    translations: [
      { targetLangId: await langId("cs"), text: "přimět k zamyšlení", details: { synonyms: [], examples: [] } },
      ...(options.keepNative
        ? [{ targetLangId: await langId("ru"), text: nativeTranslation, details: { synonyms: [], examples: [] } }]
        : []),
    ],
  });

  await db.insert(videoPhrases).values({
    videoProcessId: process!.id,
    phrase,
    nativeTranslation,
    sortOrder: 1,
    savedEntryId: entry.id,
  });
  return entry.id;
}

async function nativeRowFor(entryId: number): Promise<{ text: string } | undefined> {
  const db = getDb();
  const rows = await db
    .select({ text: vocabularyTranslations.text })
    .from(vocabularyTranslations)
    .where(
      and(eq(vocabularyTranslations.entryId, entryId), eq(vocabularyTranslations.targetLangId, await langId("ru"))),
    );
  return rows[0];
}

/** The repair is global, so every assertion is scoped to this test's own entry. */
async function repairableIds(): Promise<Map<number, string>> {
  return new Map((await findRepairableNativeTranslations()).map((row) => [row.entryId, row.text]));
}

describe("repair-native-translations (integration)", () => {
  it("restores the native translation verbatim from the phrase the save came from", async () => {
    const userId = await arrangeLearner();
    const entryId = await arrangeDamagedVideoEntry(userId, "give pause", "заставить задуматься");

    expect(await nativeRowFor(entryId)).toBeUndefined();
    const found = await repairableIds();
    expect(found.get(entryId)).toBe("заставить задуматься");

    const written = await restoreNativeTranslations([
      {
        entryId,
        original: "give pause",
        nativeLang: "ru",
        nativeLangId: await langId("ru"),
        text: found.get(entryId)!,
        source: "video",
      },
    ]);

    expect(written).toBe(1);
    expect((await nativeRowFor(entryId))?.text).toBe("заставить задуматься");
  });

  it("is a no-op on a second run", async () => {
    const userId = await arrangeLearner();
    const entryId = await arrangeDamagedVideoEntry(userId, "with due respect", "при всем уважении");

    const row = {
      entryId,
      original: "with due respect",
      nativeLang: "ru",
      nativeLangId: await langId("ru"),
      text: "при всем уважении",
      source: "video",
    };
    expect(await restoreNativeTranslations([row])).toBe(1);

    // The entry has left the selection, and restoring it again writes nothing —
    // the repair can be re-run against a database it has already touched.
    expect((await repairableIds()).has(entryId)).toBe(false);
    expect(await restoreNativeTranslations([row])).toBe(0);
    expect((await nativeRowFor(entryId))?.text).toBe("при всем уважении");
  });

  it("leaves an entry that still has its native translation alone", async () => {
    const userId = await arrangeLearner();
    const entryId = await arrangeDamagedVideoEntry(userId, "outbred", "превзойти по рождаемости", {
      keepNative: true,
    });

    expect((await repairableIds()).has(entryId)).toBe(false);
  });

  it("never offers an entry that is already in the reader's own language", async () => {
    const userId = await arrangeLearner();
    const db = getDb();
    const [process] = await db
      .insert(videoProcesses)
      .values({
        userId,
        videoId: `vid${uniqueTelegramId()}`.slice(0, 11),
        videoUrl: "https://youtu.be/y",
        language: "ru",
        status: "completed",
      })
      .returning();
    const entry = await vocabularyRepository.create(userId, {
      original: "задуматься",
      sourceLangId: await langId("ru"),
      inputType: "word",
      emoji: "🤔",
      source: { type: "video", videoUrl: "https://youtu.be/y", videoTitle: "clip", timestampSeconds: 1 },
      translations: [
        { targetLangId: await langId("cs"), text: "zamyslet se", details: { synonyms: [], examples: [] } },
      ],
    });
    await db.insert(videoPhrases).values({
      videoProcessId: process!.id,
      phrase: "задуматься",
      nativeTranslation: "задуматься",
      sortOrder: 1,
      savedEntryId: entry.id,
    });

    // A word in the reader's own language is missing nothing — the source language
    // is never one of a card's answers.
    expect((await repairableIds()).has(entry.id)).toBe(false);
  });
});

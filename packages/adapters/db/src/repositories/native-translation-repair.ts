/**
 * One-off repair for entries whose native translation background enrichment
 * deleted (fixed in the bot's `entry-enrichment.helper.ts`).
 *
 * A phrase saved from a video or the word picker is written with its native
 * translation immediately; the enrichment that upgrades it to a full card seconds
 * later used to request only the learning languages, and it finishes with
 * `updateAllTranslations`, which deletes every language absent from the request.
 * So the native row was created and then dropped, and the card — left with no
 * answer block — fell back to printing its stored description.
 *
 * The original text survives on the row the save came from, so the repair
 * restores it verbatim: no AI call, no re-translation, nothing invented.
 *
 * Driven by `pnpm repair:native-translations`; delete both once it has been run
 * everywhere it needs to be.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import {
  languages,
  userLanguageSettings,
  videoPhrases,
  vocabularyEntries,
  vocabularyTranslations,
  wordPickerItems,
} from "../schema.js";

export interface RepairableNativeTranslation {
  entryId: number;
  original: string;
  nativeLang: string;
  nativeLangId: number;
  text: string;
  /** `video` / `wordPicker` — which save path the entry came from. */
  source: string;
}

/**
 * Entries whose owner's native language has no translation row at all — active or
 * not. A deactivated row is left alone rather than revived: this restores what a
 * bug deleted, not what a user removed.
 */
export async function findRepairableNativeTranslations(): Promise<RepairableNativeTranslation[]> {
  const db = getDb();

  const rows = await db
    .select({
      entryId: vocabularyEntries.id,
      original: vocabularyEntries.original,
      nativeLang: languages.code,
      nativeLangId: languages.id,
      videoText: videoPhrases.nativeTranslation,
      pickerText: wordPickerItems.nativeTranslation,
      sourceType: sql<string | null>`${vocabularyEntries.source}->>'type'`,
    })
    .from(vocabularyEntries)
    .innerJoin(userLanguageSettings, eq(userLanguageSettings.userId, vocabularyEntries.userId))
    .innerJoin(languages, eq(languages.code, userLanguageSettings.nativeLang))
    .leftJoin(videoPhrases, eq(videoPhrases.savedEntryId, vocabularyEntries.id))
    .leftJoin(wordPickerItems, eq(wordPickerItems.savedEntryId, vocabularyEntries.id))
    .where(
      and(
        eq(vocabularyEntries.isActive, true),
        // A word already in the reader's own language is missing nothing: the
        // source language is never one of a card's answers.
        sql`${vocabularyEntries.sourceLangId} <> ${languages.id}`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${vocabularyTranslations} vt
           WHERE vt.entry_id = ${vocabularyEntries.id}
             AND vt.target_lang_id = ${languages.id}
        )`,
      ),
    );

  // Both joins are one-to-many in principle, so an entry can arrive more than
  // once; the first row carrying text wins and the entry is repaired once.
  const byEntry = new Map<number, RepairableNativeTranslation>();
  for (const row of rows) {
    const text = row.videoText?.trim() || row.pickerText?.trim();
    if (!text || byEntry.has(row.entryId)) continue;
    byEntry.set(row.entryId, {
      entryId: row.entryId,
      original: row.original,
      nativeLang: row.nativeLang,
      nativeLangId: row.nativeLangId,
      text,
      source: row.sourceType ?? "unknown",
    });
  }
  return [...byEntry.values()];
}

/** Write the rows back, skipping anything a concurrent write has since created. */
export async function restoreNativeTranslations(repairable: readonly RepairableNativeTranslation[]): Promise<number> {
  if (repairable.length === 0) return 0;
  const db = getDb();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const written = await db
    .insert(vocabularyTranslations)
    .values(
      repairable.map((row) => ({
        entryId: row.entryId,
        targetLangId: row.nativeLangId,
        text: row.text,
        details: { synonyms: [], examples: [] },
        srsDueDate: tomorrow,
      })),
    )
    .onConflictDoNothing({ target: [vocabularyTranslations.entryId, vocabularyTranslations.targetLangId] })
    .returning({ entryId: vocabularyTranslations.entryId });
  return written.length;
}

/**
 * One-off repair for translation rows stored in their entry's own language.
 *
 * The just-in-time translation behind a review notification used to ask for the
 * user's learning languages flat, including the language the word was saved in.
 * The model answered with a same-language paraphrase, `updateTranslation`
 * inserted it as a fresh row due tomorrow, and the learner got a Czech word
 * offered as the translation of itself. Fixed at the source in the bot's
 * `notification.wiring.ts` and at the save boundary in `vocabulary-mapper.ts`.
 *
 * Such a row carries no meaning the entry does not already carry — the headword
 * is the same word — so it is deleted rather than deactivated. Deleting also
 * clears the way for a real translation into that language should the entry's
 * source language ever be corrected.
 *
 * Driven by `apps/bot/src/repair-self-language-translations.cli.ts`; delete both
 * once dev and production have each run a deploy carrying them.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { vocabularyEntries, vocabularyTranslations } from "../schema.js";

/**
 * Drop every translation row whose target language is its entry's source
 * language, on whichever database this process is pointed at.
 *
 * Idempotent in the data: a second run finds nothing and deletes nothing.
 *
 * @returns how many rows were removed
 */
export async function deleteSelfLanguageTranslations(): Promise<number> {
  const db = getDb();

  const deleted = await db
    .delete(vocabularyTranslations)
    .where(
      sql`EXISTS (
        SELECT 1 FROM ${vocabularyEntries} ve
         WHERE ve.id = ${vocabularyTranslations.entryId}
           AND ve.source_lang_id = ${vocabularyTranslations.targetLangId}
      )`,
    )
    .returning({ entryId: vocabularyTranslations.entryId });

  return deleted.length;
}

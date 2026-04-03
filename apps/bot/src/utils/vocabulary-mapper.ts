/**
 * Maps TranslateOutput → CreateVocabularyInput for the normalized vocabulary schema.
 *
 * This mapper lives in the bot layer because it bridges two types:
 *   - TranslateOutput (from @polyglot/core — translation result)
 *   - CreateVocabularyInput (from @polyglot/adapter-db — storage input)
 *
 * Replaces the old sanitizeForStorage() which produced a monolithic JSONB blob.
 * Now produces a normalized parent + per-language children structure.
 */
import type { CreateVocabularyInput, VocabTranslationDetails } from "@polyglot/adapter-db";
import type { TranslateOutput } from "@polyglot/core";
import { logger } from "@polyglot/infra";

/**
 * Resolves a language code to its database ID.
 * Returns null if the language is unknown.
 */
export type LangResolver = (code: string) => number | null;

/**
 * Convert a TranslateOutput into a CreateVocabularyInput ready for
 * vocabularyRepository.create().
 *
 * - Extracts `emoji`, `register` to parent level
 * - For each translation[code]: resolves code → targetLangId via langResolver
 * - Builds `details: { synonyms, examples, alternatives }` JSONB per translation
 * - Strips transient fields: needsReview, dictionaryContext, original, sourceLang
 * - Skips languages where langResolver returns null (logs a warning)
 *
 * @param output        Full AI translation output
 * @param sourceLangId  Resolved source language FK
 * @param inputType     Classified input type (word/phrase)
 * @param langResolver  Maps language code → languages.id (or null if unknown)
 */
export function toVocabularyInput(
  output: TranslateOutput,
  sourceLangId: number,
  inputType: "word" | "phrase",
  langResolver: LangResolver,
): CreateVocabularyInput {
  const translations: CreateVocabularyInput["translations"] = [];

  for (const [code, lang] of Object.entries(output.translations)) {
    const targetLangId = langResolver(code);
    if (targetLangId === null) {
      logger.warn({ code, original: output.original }, "Unknown language code — skipping translation");
      continue;
    }

    const details: VocabTranslationDetails = {
      synonyms: lang.synonyms ?? [],
      examples: lang.examples ?? [],
      alternatives: lang.alternatives,
    };

    translations.push({
      targetLangId,
      text: lang.text,
      register: lang.register,
      transcription: lang.transcription,
      expressionType: lang.expressionType,
      equivalentNote: lang.equivalentNote,
      connotationWarning: lang.connotationWarning,
      details,
    });
  }

  return {
    original: output.original,
    sourceLangId,
    inputType,
    emoji: output.emoji,
    register: output.register,
    translations,
  };
}

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
import type {
  CreateVocabularyInput,
  LanguageTranslation,
  TranslateOutput,
  VocabTranslationDetails,
  VocabularyEntryWithTranslations,
} from "@polyglot/core";
import { logger } from "@polyglot/core";

/**
 * Resolves a language code to its database ID.
 * Returns null if the language is unknown.
 */
export type LangResolver = (code: string) => number | null;

/**
 * Convert a TranslateOutput into a CreateVocabularyInput ready for
 * vocabularyRepository.create().
 *
 * - Extracts `emoji` to parent level
 * - For each translation[code]: resolves code → targetLangId via langResolver
 * - Builds `details: { synonyms, examples, alternatives }` JSONB per translation
 * - Strips transient fields: needsReview, dictionaryContext, original, sourceLang
 * - Skips languages where langResolver returns null (logs a warning)
 * - Skips the entry's own source language (logs a warning)
 *
 * @param output        Full AI translation output
 * @param sourceLangId  Resolved source language FK
 * @param inputType     Classified input type (word/phrase)
 * @param langResolver  Maps language code → languages.id (or null if unknown)
 */
export function toVocabularyInput(
  output: TranslateOutput,
  sourceLangId: number,
  inputType: "word" | "phrase" | "sentence",
  langResolver: LangResolver,
): CreateVocabularyInput {
  const translations: CreateVocabularyInput["translations"] = [];

  for (const [code, lang] of Object.entries(output.translations)) {
    // A block in the entry's own language is a paraphrase, not a translation, and
    // stored it becomes a review card asking the word to be recalled from itself.
    if (code === output.sourceLang) {
      logger.warn({ code, original: output.original }, "Translation into the source language — skipping translation");
      continue;
    }

    const targetLangId = langResolver(code);
    if (targetLangId === null) {
      logger.warn({ code, original: output.original }, "Unknown language code — skipping translation");
      continue;
    }

    const details: VocabTranslationDetails = {
      synonyms: lang.synonyms ?? [],
      examples: lang.examples ?? [],
      alternatives: lang.alternatives ?? undefined,
    };

    translations.push({
      targetLangId,
      text: lang.text,
      expressionType: lang.expressionType ?? undefined,
      equivalentNote: lang.equivalentNote ?? undefined,
      usageNote: lang.usageNote ?? undefined,
      connotationWarning: lang.connotationWarning ?? undefined,
      details,
    });
  }

  return {
    original: output.original,
    sourceLangId,
    inputType,
    emoji: output.emoji,
    nativeMeaning: output.nativeMeaning,
    sourceUsage: output.sourceUsage,
    unverified: output.unverified === true,
    translations,
  };
}

/**
 * Convert a saved entry back into the {@link TranslateOutput} the translation
 * card renders from — the inverse of {@link toVocabularyInput}, minus what the
 * schema never stored.
 *
 * This is what lets a surface that holds a saved word (a revealed notification)
 * show the card the user got when they translated it, with its own keyboard,
 * instead of a second rendering of the same data: the card is `renderTranslation`
 * of this output, and there is no way for the two to drift.
 *
 * `nativeSynonyms` comes back empty because `toVocabularyInput` never persisted
 * it — a saved word has not carried one since the normalized schema landed.
 * Translations whose language row no longer resolves are dropped: a card cannot
 * label a block it has no code for.
 */
export function toTranslateOutput(
  entry: VocabularyEntryWithTranslations,
  codeResolver: (langId: number) => string | undefined,
): TranslateOutput | null {
  const sourceLang = codeResolver(entry.sourceLangId);
  if (!sourceLang) {
    logger.warn(
      { entryId: entry.id, sourceLangId: entry.sourceLangId },
      "Unknown source language — cannot render card",
    );
    return null;
  }

  const translations: Record<string, LanguageTranslation> = {};
  for (const translation of entry.translations) {
    const code = codeResolver(translation.targetLangId);
    if (!code) continue;
    translations[code] = {
      text: translation.text,
      synonyms: translation.details?.synonyms ?? [],
      examples: translation.details?.examples ?? [],
      expressionType: translation.expressionType as LanguageTranslation["expressionType"],
      equivalentNote: translation.equivalentNote,
      usageNote: translation.usageNote,
      connotationWarning: translation.connotationWarning,
      alternatives: translation.details?.alternatives ?? null,
    };
  }

  return {
    original: entry.original,
    sourceLang,
    ...(entry.emoji ? { emoji: entry.emoji } : {}),
    ...(entry.nativeMeaning ? { nativeMeaning: entry.nativeMeaning } : {}),
    ...(entry.sourceUsage ? { sourceUsage: entry.sourceUsage } : {}),
    nativeSynonyms: [],
    translations,
    ...(entry.unverified ? { unverified: true } : {}),
  };
}

import { logEvent } from "../../observability/events.js";
import type { LanguageCachePort } from "../../ports/language-cache.port.js";
import type { VocabularyRepository } from "../../ports/vocabulary.repository.js";
import type { VocabularyDictionaryRepository } from "../../ports/vocabulary-dictionary.repository.js";
import type { TranslateOutput } from "../translation/types.js";
import { toVocabularyInput } from "../vocabulary/vocabulary-mapper.js";
import type { TranslationChannel } from "./run-translation.js";

export interface SaveTranslationDeps {
  languageCache: Pick<LanguageCachePort, "getLang">;
  vocabulary: Pick<VocabularyRepository, "findByOriginalAndSource" | "restore" | "create">;
  dictionaries: Pick<VocabularyDictionaryRepository, "entryBelongsToDefault" | "addEntryToDefault">;
}

/**
 * The one save rule, whatever triggers it (the bot's Save button, the web's auto-save):
 * re-link an existing entry, else create it, always in the default dictionary.
 */
export async function saveTranslationToDictionary(
  deps: SaveTranslationDeps,
  userId: number,
  output: TranslateOutput,
  inputType: "word" | "phrase" | "sentence",
  channel: TranslationChannel,
): Promise<number | null> {
  const sourceLang = deps.languageCache.getLang(output.sourceLang);
  if (!sourceLang) return null;
  const existing = await deps.vocabulary.findByOriginalAndSource(userId, output.original, sourceLang.id);
  if (existing) {
    // A word the user removed earlier comes back on a new translation, as the bot's Save restores it.
    if (!existing.isActive) await deps.vocabulary.restore(existing.id, userId);
    if (!(await deps.dictionaries.entryBelongsToDefault(userId, existing.id))) {
      await deps.dictionaries.addEntryToDefault(userId, existing.id);
    }
    return existing.id;
  }
  const input = toVocabularyInput(
    output,
    sourceLang.id,
    inputType,
    (code) => deps.languageCache.getLang(code)?.id ?? null,
  );
  const created = await deps.vocabulary.create(userId, input);
  await deps.dictionaries.addEntryToDefault(userId, created.id);
  logEvent("vocabulary.saved", {
    entryId: created.id,
    word: output.original,
    sourceLang: output.sourceLang,
    inputType,
    channel,
  });
  return created.id;
}

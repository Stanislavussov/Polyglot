import { logger } from "../../logger.js";
import type { ServiceContainer } from "../../ports/container.js";
import { resolveDefaultAIModel } from "../../shared/ai-model.js";
import { resolveOutputConfig } from "../../shared/translation-template.service.js";
import { translateWithContext } from "../context-enrichment/context-enrichment.service.js";
import { toVocabularyInput } from "./vocabulary-mapper.js";

export type EnrichSavedEntryDeps = Pick<
  ServiceContainer,
  "translationTemplateRepository" | "userRepository" | "settings" | "ai" | "languageCache" | "vocabularyRepository"
>;

export interface EnrichEntryInput {
  entryId: number;
  /** The saved headword, in the language it was saved from. */
  word: string;
  inputType: "word" | "phrase";
  sourceLangCode: string;
  userId: number;
  plan?: string;
  /** Called once with the outcome, so each caller can count it on its own metric. */
  onOutcome?: (status: "success" | "error") => void;
}

/**
 * Background upgrade of a freshly saved vocabulary entry to a full card.
 *
 * The save paths that create an entry from an already-translated list (video
 * phrases, word-picker items) persist what they have optimistically so the tap
 * feels instant. That entry carries one translation and no synonyms, examples or
 * alternatives — this fills it in afterwards through the normal translation
 * pipeline, honouring the user's template.
 *
 * Failures are logged and swallowed: the entry the user saved is already in their
 * dictionary, and a failed enrichment must not surface as an error on a save that
 * succeeded.
 */
export async function enrichSavedEntry(deps: EnrichSavedEntryDeps, input: EnrichEntryInput): Promise<void> {
  const { entryId, word, inputType, sourceLangCode, userId } = input;
  try {
    const savedTemplate = await deps.translationTemplateRepository.getByUserId(userId);
    const userTpl = savedTemplate ? { name: savedTemplate.name, fields: savedTemplate.fields } : null;
    const outputConfig = resolveOutputConfig(userTpl, inputType, word.length);

    const userSettings = await deps.userRepository.getSettings(userId);
    const nativeLang = userSettings?.nativeLang ?? "en";
    const learningLangs = userSettings?.learningLangs ?? [];

    // The native language leads, exactly as it does on the translate card. It is
    // not optional decoration here: `updateAllTranslations` deletes rows for
    // languages absent from this set, so leaving the native language out erased
    // the native translation the optimistic save had just written, and the card
    // was left showing its stored description where the answer belongs.
    const targetLangs = [...new Set([nativeLang, ...learningLangs])].filter((code) => code !== sourceLangCode);
    // Nothing to ask for — a lone native-language word with no learning language
    // beside it. Translating it into itself is what the old fallback did.
    if (targetLangs.length === 0) return void input.onOutcome?.("success");

    const model = await resolveDefaultAIModel(deps.settings, input.plan);

    const decision = await translateWithContext(
      { word, sourceLang: sourceLangCode, targetLangs, nativeLang, model, outputConfig, inputType, userId },
      { lookupContext: async () => [], generateObjectFn: deps.ai.generateObject },
    );

    if (decision.status === "accepted" || decision.status === "needs_review") {
      const vocabInput = toVocabularyInput(
        decision.output,
        0, // sourceLangId is unused on the update path
        inputType,
        (code) => deps.languageCache.getLang(code)?.id ?? null,
      );

      await deps.vocabularyRepository.updateEntry(entryId, {
        emoji: vocabInput.emoji,
        nativeMeaning: vocabInput.nativeMeaning,
        sourceUsage: vocabInput.sourceUsage,
      });

      if (vocabInput.translations.length > 0) {
        await deps.vocabularyRepository.updateAllTranslations(entryId, vocabInput.translations);
      }
    }
    input.onOutcome?.("success");
  } catch (error) {
    input.onOutcome?.("error");
    logger.error(
      { entryId, word, error: error instanceof Error ? error.message : String(error) },
      "Failed to enrich saved vocabulary entry",
    );
  }
}

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
 * dictionary, and a failed enrichment must not surface as an error on a tap that
 * succeeded.
 */

import { logger, resolveOutputConfig, translateWithContext } from "@polyglot/core";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { toVocabularyInput } from "../../utils/vocabulary-mapper.js";
import { getUserLanguageGroup } from "./translate-mode.shared.js";

export interface EnrichEntryInput {
  entryId: number;
  /** The saved headword, in the language it was saved from. */
  word: string;
  inputType: "word" | "phrase";
  sourceLangCode: string;
  userId: number;
  /** Called once with the outcome, so each caller can count it on its own metric. */
  onOutcome?: (status: "success" | "error") => void;
}

export async function enrichEntryInBackground(ctx: BotContext, input: EnrichEntryInput): Promise<void> {
  const { entryId, word, inputType, sourceLangCode, userId } = input;
  try {
    const savedTemplate = await ctx.services.translationTemplateRepository.getByUserId(userId);
    const userTpl = savedTemplate ? { name: savedTemplate.name, fields: savedTemplate.fields } : null;
    const outputConfig = resolveOutputConfig(userTpl, inputType, word.length);

    const userSettings = await ctx.services.userRepository.getSettings(userId);
    const nativeLang = userSettings?.nativeLang ?? "en";
    const learningLangs = userSettings?.learningLangs ?? [];

    // The native language leads, exactly as it does on the translate card. It is
    // not optional decoration here: `updateAllTranslations` deletes rows for
    // languages absent from this set, so leaving the native language out erased
    // the native translation the optimistic save had just written, and the card
    // was left showing its stored description where the answer belongs.
    const targetLangs = getUserLanguageGroup(nativeLang, learningLangs).filter((code) => code !== sourceLangCode);
    // Nothing to ask for — a lone native-language word with no learning language
    // beside it. Translating it into itself is what the old fallback did.
    if (targetLangs.length === 0) return void input.onOutcome?.("success");

    const model = await resolveDefaultAIModel(ctx.services.settings, ctx.user?.subscriptionPlan);

    const decision = await translateWithContext(
      {
        word,
        sourceLang: sourceLangCode,
        targetLangs,
        nativeLang,
        model,
        outputConfig,
        inputType,
        userId,
      },
      {
        lookupContext: async () => [],
        generateObjectFn: ctx.services.ai.generateObject,
      },
    );

    if (decision.status === "accepted" || decision.status === "needs_review") {
      const vocabInput = toVocabularyInput(
        decision.output,
        0, // sourceLangId is unused on the update path
        inputType,
        (code) => ctx.services.languageCache.getLang(code)?.id ?? null,
      );

      await ctx.services.vocabularyRepository.updateEntry(entryId, {
        emoji: vocabInput.emoji,
        nativeMeaning: vocabInput.nativeMeaning,
        sourceUsage: vocabInput.sourceUsage,
      });

      if (vocabInput.translations.length > 0) {
        await ctx.services.vocabularyRepository.updateAllTranslations(entryId, vocabInput.translations);
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

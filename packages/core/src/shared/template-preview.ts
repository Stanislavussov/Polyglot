import type { TranslateOutput } from "../modules/translation/types.js";
import type { TemplateFields } from "./translation-template.types.js";

/** A realistic card for the template editor's preview, so every toggled section has something to show. */
export const TEMPLATE_PREVIEW_OUTPUT: TranslateOutput = {
  original: "apple",
  sourceLang: "en",
  emoji: "🍎",
  nativeSynonyms: [{ text: "яблоко" }],
  translations: {
    ru: {
      text: "яблоко",
      synonyms: [{ text: "фрукт" }, { text: "плод" }],
      examples: [
        { context: "neutral", target: "Я купил яблоко в магазине." },
        { context: "colloquial", target: "Кинь мне яблочко!" },
        { context: "professional", target: "Поставка яблок осуществляется еженедельно." },
      ],
      alternatives: [
        {
          text: "фрукт",
          synonyms: [{ text: "плод" }],
        },
      ],
      connotationWarning: "In slang, can mean a tech company",
    },
  },
};

/**
 * The card with the sections the user's template turns off removed — the same
 * sections the bot's card renderer skips, so a web card and a Telegram card of
 * one translation show the same parts.
 */
export function applyTemplateFields(output: TranslateOutput, fields: TemplateFields): TranslateOutput {
  const translations = Object.fromEntries(
    Object.entries(output.translations).map(([lang, translation]) => [
      lang,
      {
        ...translation,
        synonyms: fields.synonyms ? translation.synonyms : [],
        examples: fields.examples ? translation.examples : [],
        alternatives: fields.alternatives ? translation.alternatives : [],
        connotationWarning: fields.connotationWarning ? translation.connotationWarning : undefined,
      },
    ]),
  );
  return {
    ...output,
    nativeSynonyms: fields.synonyms ? output.nativeSynonyms : [],
    sourceUsage: output.sourceUsage
      ? {
          ...output.sourceUsage,
          synonyms: fields.synonyms ? output.sourceUsage.synonyms : [],
          examples: fields.examples ? output.sourceUsage.examples : [],
        }
      : output.sourceUsage,
    translations,
  };
}

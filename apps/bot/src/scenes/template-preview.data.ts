/**
 * Mock translation output used for template preview in the wizard.
 * Provides realistic data so users can see what each toggled section looks like.
 */
import type { TranslateOutput } from "@polyglot/core";

export const MOCK_PREVIEW_OUTPUT: TranslateOutput = {
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

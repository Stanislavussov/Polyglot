/**
 * Mock translation output used for template preview in the wizard.
 * Provides realistic data so users can see what each toggled section looks like.
 */
import type { TranslateOutput } from "@polyglot/core";

export const MOCK_PREVIEW_OUTPUT: TranslateOutput = {
  original: "apple",
  sourceLang: "en",
  emoji: "🍎",
  register: "neutral",
  nativeSynonyms: [{ text: "яблоко", register: "neutral" }],
  translations: {
    ru: {
      text: "яблоко",
      transcription: "ˈjabləkə",
      register: "neutral",
      synonyms: [
        { text: "фрукт", register: "neutral" },
        { text: "плод", register: "literary" },
      ],
      examples: [
        { context: "neutral", target: "Я купил яблоко в магазине.", register: "нейтральный" },
        { context: "colloquial", target: "Кинь мне яблочко!", register: "разговорный" },
        { context: "professional", target: "Поставка яблок осуществляется еженедельно.", register: "деловой" },
      ],
      alternatives: [
        {
          text: "фрукт",
          register: "neutral",
          synonyms: [{ text: "плод", register: "literary" }],
        },
      ],
      connotationWarning: "In slang, can mean a tech company",
    },
  },
};

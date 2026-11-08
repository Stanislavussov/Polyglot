import type { I18nKey } from "../i18n/types.js";
import type { GrammarIssueCategory } from "./grammar-check.schema.js";

/** One label per category, shared so the bot answer and the web card name a mistake alike. */
export const GRAMMAR_CATEGORY_KEYS: Record<GrammarIssueCategory, I18nKey> = {
  grammar: "grammarCategoryGrammar",
  vocabulary: "grammarCategoryVocabulary",
  preposition: "grammarCategoryPreposition",
  article: "grammarCategoryArticle",
  word_order: "grammarCategoryWordOrder",
  agreement: "grammarCategoryAgreement",
  tense: "grammarCategoryTense",
  spelling: "grammarCategorySpelling",
  punctuation: "grammarCategoryPunctuation",
  other: "grammarCategoryOther",
};

/** What a user may send as one check, in characters — the same cap on every channel. */
export const GRAMMAR_MAX_INPUT_LENGTH = 1000;

/**
 * Output budget for one check: up to eight issues, each with an explanation and
 * an example, plus the corrected text — well past the mentor's 700-token prose cap.
 */
export const GRAMMAR_CHECK_MAX_TOKENS = 2000;

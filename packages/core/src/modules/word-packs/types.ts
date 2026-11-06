/**
 * Word packs — an author's saved words turned into a set every learner can
 * receive in the language they study (Task 87).
 */
import type { CefrLevel } from "../word-picker/types.js";

/** One word as the author saved it. */
export interface PackSourceWord {
  headword: string;
  /** ISO 639-1 code of the language the word is in. */
  lang: string;
}

/** A language a pack word is localized into. */
export interface PackLanguage {
  code: string;
  /** English name, as the model is asked in English. */
  name: string;
}

/** One pack word, ready to store. */
export interface LocalizedPackWord {
  sourceLang: string;
  sourceHeadword: string;
  level: CefrLevel;
  emoji: string;
  /** Language code → the word in that language. A language with no real equivalent is absent. */
  headwords: Record<string, string>;
}

export interface PackLocalizationRequest {
  words: PackSourceWord[];
  languages: PackLanguage[];
  /** Words below this level are dropped: a lapsed user is won back by surprise, not by "cat". */
  minLevel: CefrLevel;
}

export interface PackLocalizationOutcome {
  items: LocalizedPackWord[];
  /** Source headwords dropped for being below `minLevel`. */
  tooEasy: string[];
  /** Source headwords the model returned nothing for. */
  unresolved: string[];
}

/** The model's answer for one batch; `index` points back into the batch's numbered list. */
export interface PackLocalizationResult {
  words: Array<{
    index: number;
    level: CefrLevel;
    emoji: string;
    equivalents: Array<{ languageCode: string; headword: string }>;
  }>;
}

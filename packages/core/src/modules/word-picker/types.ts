/**
 * Word-picker module types — curated "angles" on a language turned into word sets.
 *
 * A preset is a stored angle (title + prompt) an admin authors; a pick is one
 * AI-generated batch of items for one learner, language and angle.
 */

export type PickedItemType = "word" | "phrase" | "idiom" | "collocation";

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/** One item the model picked for an angle. */
export interface PickedItem {
  /** Dictionary form of the word or phrase, in the language being learned. */
  word: string;
  nativeTranslation: string;
  emoji: string;
  type: PickedItemType;
  level: CefrLevel;
  /** A natural sentence in the learning language showing the item in use. */
  exampleTarget: string;
  exampleNative: string;
  /** One sentence, in the learner's native language, on what the angle reveals here. */
  note: string;
}

export interface PickResult {
  items: PickedItem[];
}

export interface WordPickRequest {
  /** Human title of the angle, e.g. "Untranslatable". */
  angleTitle: string;
  /** The admin-authored instruction that defines the angle. */
  anglePrompt: string;
  /** Display name of the language being learned, e.g. "German". */
  learningLanguage: string;
  /** Display name of the learner's native language, e.g. "Russian". */
  nativeLanguage: string;
  level: string;
  count: number;
  /** Items the learner has already seen or saved — never picked again. */
  knownWords: string[];
}

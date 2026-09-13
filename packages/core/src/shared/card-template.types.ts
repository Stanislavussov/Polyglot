/**
 * What the hidden-answer side of a review card may show besides the word itself.
 *
 * Every field is chosen so it can help recall without handing over the answer:
 * source-language synonyms, one source-language example with its native gloss
 * removed, and the stored recall hint. The meaning, the translation and the
 * native gloss are never options — they are what the reader is trying to recall.
 */
export interface CardFrontFields {
  /** Source-language synonyms beside the headword. */
  synonyms: boolean;
  /** One saved source-language example sentence, without its translation. */
  example: boolean;
  /** The native-language nudge generated with the translation (`SourceUsage.recallHint`). */
  hint: boolean;
}

/** Single source of truth for a user who never opened the card settings. */
export const DEFAULT_CARD_FRONT_FIELDS: Readonly<CardFrontFields> = Object.freeze({
  synonyms: true,
  example: false,
  hint: false,
});

/** Toggleable keys in settings display order. */
export const CARD_FRONT_FIELD_KEYS: ReadonlyArray<keyof CardFrontFields> = ["hint", "synonyms", "example"];

export function isCardFrontField(value: string): value is keyof CardFrontFields {
  return (CARD_FRONT_FIELD_KEYS as readonly string[]).includes(value);
}

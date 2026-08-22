/**
 * Which languages on a translation card get a pronunciation button.
 *
 * The rule is "only the words being learned": a speaker appears next to a
 * learning-language translation and nowhere else. The native line is what the
 * user already speaks, so voicing it is noise.
 */
import type { LanguageOrderContext } from "../vocabulary/translation-order.js";
import { orderRecordEntries } from "../vocabulary/translation-order.js";

/** The minimum a translation entry must expose to be worth speaking. */
interface SpeakableEntry {
  text: string;
}

/**
 * Learning languages present on the card, in the card's own display order.
 *
 * Ordering reuses {@link orderRecordEntries} so the buttons appear in the same
 * order as the blocks above them and never reshuffle between taps — the session
 * stores translations as a jsonb record, which reads back alphabetized.
 *
 * Both inputs come from state the caller already has: `translations` is the card's
 * own record, and `order` carries the user's `learningLangs` and `nativeLang`.
 */
export function selectPronounceableLangs(
  translations: Readonly<Record<string, SpeakableEntry | undefined>>,
  order: LanguageOrderContext,
): readonly string[] {
  const learning = new Set(order.learningLangs);
  return orderRecordEntries(translations, order)
    .filter(([code, entry]) => {
      if (!learning.has(code)) return false;
      if (order.nativeLang !== undefined && code === order.nativeLang) return false;
      return typeof entry?.text === "string" && entry.text.trim().length > 0;
    })
    .map(([code]) => code);
}

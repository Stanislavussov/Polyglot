/**
 * Which words on a translation card get a pronunciation button.
 *
 * The rule is "everything the user does not already speak": every language on
 * the card except their native one. That includes the source word itself — on a
 * reverse-learning card (the user typed a word in a language they study) the
 * headword sits at the top of the card and is absent from `translations`, so it
 * used to be the one word on the card that could not be heard.
 */
import type { LanguageOrderContext } from "../vocabulary/translation-order.js";
import { orderRecordEntries } from "../vocabulary/translation-order.js";

/** The minimum a translation entry must expose to be worth speaking. */
interface SpeakableEntry {
  text: string;
}

/** The part of a translation card that carries speakable words. */
export interface SpeakableCard {
  readonly sourceLang: string;
  readonly original: string;
  readonly sourceUsage?: { readonly headword?: string | null } | null;
  readonly translations: Readonly<Record<string, SpeakableEntry | undefined>>;
}

function nonBlank(text: string | undefined | null): string {
  return typeof text === "string" ? text.trim() : "";
}

/**
 * The source word as the card displays it, or "" when it is not speakable.
 *
 * Mirrors the renderer: the citation headword (German "die Arbeit" for the input
 * "arbeit") wins over the raw input when the model supplied one. A source word in
 * the user's native language is not offered — that is the word they came with.
 */
function speakableSourceWord(card: SpeakableCard, order: LanguageOrderContext): string {
  if (order.nativeLang !== undefined && card.sourceLang === order.nativeLang) return "";
  return nonBlank(card.sourceUsage?.headword) || nonBlank(card.original);
}

/**
 * Languages on the card whose word can be spoken, in the card's own display order.
 *
 * The source word leads, as it does on the card; the translations follow in the
 * user's language order via {@link orderRecordEntries}, so the buttons never
 * reshuffle between taps — the session stores translations as a jsonb record,
 * which reads back alphabetized.
 */
export function selectPronounceableLangs(card: SpeakableCard, order: LanguageOrderContext): readonly string[] {
  const codes: string[] = [];
  if (speakableSourceWord(card, order)) codes.push(card.sourceLang);

  for (const [code, entry] of orderRecordEntries(card.translations, order)) {
    if (codes.includes(code)) continue;
    if (order.nativeLang !== undefined && code === order.nativeLang) continue;
    if (!nonBlank(entry?.text)) continue;
    codes.push(code);
  }
  return codes;
}

/**
 * The exact text a `tr:say:{lang}` tap should speak — always the one the card
 * shows for that language, so the audio and the text on screen cannot diverge.
 */
export function resolvePronounceableText(card: SpeakableCard, langCode: string, order: LanguageOrderContext): string {
  if (langCode === card.sourceLang) {
    const sourceWord = speakableSourceWord(card, order);
    if (sourceWord) return sourceWord;
  }
  return nonBlank(card.translations[langCode]?.text);
}

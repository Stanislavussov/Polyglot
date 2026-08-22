/**
 * The canonical card grammar.
 *
 * Every surface that shows a word and its translations renders the same sections
 * in the same sequence. Order lives here — in {@link CARD_SECTION_ORDER} — and
 * nowhere else, so a renderer cannot reorder the card by shuffling its own
 * `push` calls.
 *
 * The rule the order encodes: **the answer is the first content line after the
 * headword.** A learner opens a card to find out what the word means in the
 * language they think in; anything that pushes that below a description, a
 * provenance label, or a section header is the defect this module exists to
 * prevent.
 *
 * **What this buys, precisely.** {@link assembleCard} takes a total
 * `Record` rather than a `Partial`, so every caller names every section and
 * adding a section here is a compile error at every call site — the same forcing
 * function that made the `LanguageOrderContext` rollout stick. It does **not**
 * stop a caller putting meaning-shaped text in the `answer` slot, nor collapsing
 * several sections into one string. Those are caught by the per-surface
 * whole-message tests, not by types.
 */
import { getLangFlag } from "@polyglot/core";

/**
 * Section sequence, top to bottom. The single source of truth for card order.
 *
 * `provenance` sits above `headword` deliberately: it labels the whole card
 * ("from your dictionary"), so it reads as a header rather than as content
 * competing with the answer.
 */
export const CARD_SECTION_ORDER = [
  "chrome",
  "provenance",
  "headword",
  "answer",
  "meaning",
  "examples",
  "others",
  "aids",
  "caveats",
  "footer",
] as const;

export type CardSection = (typeof CARD_SECTION_ORDER)[number];

/** Escape HTML special characters for Telegram. */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render a language's label.
 *
 * The flag alone when one resolves — pairing it with the ISO code says the same
 * thing twice. When it does not resolve, the code is kept: a bare `🔤` would
 * leave the reader unable to tell which language the line belongs to.
 */
export function langLabel(code: string): string {
  const flag = getLangFlag(code);
  return flag ?? `🔤 ${esc(code.toUpperCase())}:`;
}

/** Join synonyms into the trailing `(a, b)` form shared by the headword and answer lines. */
function synonymSuffix(synonyms: readonly string[]): string {
  return synonyms.length > 0 ? ` (${synonyms.map(esc).join(", ")})` : "";
}

/**
 * The word being learned. `sourceFlag` is the card's only source-language flag —
 * surfaces that also render a source-usage block must not repeat it there.
 */
export function headwordLine(
  headword: string,
  options: { emoji?: string; sourceLang?: string; synonyms?: readonly string[] } = {},
): string {
  const emoji = options.emoji ? `${esc(options.emoji)} ` : "";
  const flag = options.sourceLang ? ` ${getLangFlag(options.sourceLang) ?? "🔤"}` : "";
  return `${emoji}<b>${esc(headword)}</b>${flag}${synonymSuffix(options.synonyms ?? [])}`;
}

/** The answer — bold, because it is what the reader came for. */
export function answerLine(code: string, text: string, synonyms: readonly string[] = []): string {
  return `${langLabel(code)} <b>${esc(text)}</b>${synonymSuffix(synonyms)}`;
}

/** A secondary language: one line, unbolded, no synonyms. */
export function otherLangLine(code: string, text: string): string {
  return `${langLabel(code)} ${esc(text)}`;
}

/**
 * Anything explanatory — a stored meaning, a usage note, a connotation warning.
 * One glyph for all of them: `ℹ️` previously meant two different things on the
 * same card.
 */
export function meaningLine(text: string): string {
  return `💡 ${esc(text)}`;
}

/** An example sentence, with its native gloss in parentheses when there is one. */
export function exampleLine(target: string, native?: string): string {
  return `💬 <i>${esc(target)}</i>${native ? ` (${esc(native)})` : ""}`;
}

/**
 * Wrap detail lines in a Telegram expandable blockquote (Bot API 7.3+): the
 * client renders them collapsed, so no buttons, no editMessageText, and none of
 * the 48-hour edit limit that kills button-based reveals on old cards.
 */
export function expandableSection(lines: readonly string[]): string[] {
  return lines.length > 0 ? [`<blockquote expandable>${lines.join("\n")}</blockquote>`] : [];
}

/**
 * Emit the sections in {@link CARD_SECTION_ORDER}.
 *
 * Empty sections vanish rather than leaving a blank line, so a surface that omits
 * a section costs nothing visually. Callers that want a blank separator include
 * an empty string as one of that section's lines.
 */
export function assembleCard(sections: Record<CardSection, readonly string[]>): string {
  const lines: string[] = [];
  for (const section of CARD_SECTION_ORDER) {
    lines.push(...sections[section]);
  }
  return lines.join("\n").trim();
}

/** An all-empty section map, for callers that fill in only a few sections. */
export function emptySections(): Record<CardSection, readonly string[]> {
  return {
    chrome: [],
    provenance: [],
    headword: [],
    answer: [],
    meaning: [],
    examples: [],
    others: [],
    aids: [],
    caveats: [],
    footer: [],
  };
}

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

/** A language's flag, or `🔤` when the code is unknown or has no flag. */
export function langFlag(code: string | undefined): string {
  return (code ? getLangFlag(code) : undefined) ?? "🔤";
}

/**
 * `🇷🇺 RU:` — what precedes every translation on every card.
 *
 * The ISO code rides along with the flag rather than being dropped as
 * duplication: flags are hard to tell apart at a glance (🇷🇺/🇧🇾, 🇩🇪/🇧🇪, and any
 * pair on a small screen), and a reader scanning a multi-language card is
 * looking for one specific language.
 */
export function langLabel(code: string | undefined): string {
  return code ? `${langFlag(code)} ${esc(code.toUpperCase())}:` : langFlag(code);
}

/** Join synonyms into the trailing `(a, b)` form shared by the headword and answer lines. */
function synonymSuffix(synonyms: readonly string[]): string {
  return synonyms.length > 0 ? ` (${synonyms.map(esc).join(", ")})` : "";
}

/**
 * The word being learned: emoji, the source-language label, the word, and its
 * source-language synonyms — the card's only mention of the source language, so a
 * surface that also renders a source-usage block must not repeat it there.
 *
 * It wears {@link langLabel}, the same label as every answer, for the reason given
 * there: a bare flag does not survive a glance on a small screen, and the headword
 * is the one line whose language the reader must be sure of before reading
 * anything below it. The label precedes the word rather than trailing it — it says
 * which language you are looking at, which is needed before the word, not after.
 */
export function headwordLine(
  headword: string,
  options: {
    emoji?: string | null;
    sourceLang?: string;
    synonyms?: readonly string[];
    /** Trailing per-surface badge — a CEFR level, a saved ✅. Never content. */
    badge?: string;
  } = {},
): string {
  const emoji = options.emoji ? `${esc(options.emoji)} ` : "";
  const synonyms = synonymSuffix(options.synonyms ?? []);
  return `${emoji}${langLabel(options.sourceLang)} <b>${esc(headword)}</b>${synonyms}${options.badge ?? ""}`;
}

/**
 * A translation — bold, because it is what the reader came for. Every language on
 * the card gets this same line: a secondary language is still an answer, and
 * demoting it to plain text made one card read as two different kinds of list.
 *
 * `code` is required, and that is the point: this line promises the reader that
 * the text beside it is *that language's* word for the headword. Text we cannot
 * attribute to a language cannot make that promise, so a caller holding an
 * unresolved language must render it as {@link meaningLine} rather than reach for
 * a label naming nothing — the `🔤 <b>дом</b>` line that read as a translation
 * into no language at all.
 */
export function answerLine(code: string, text: string, synonyms: readonly string[] = []): string {
  return `${langLabel(code)} <b>${esc(text)}</b>${synonymSuffix(synonyms)}`;
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
export function exampleLine(target: string, native?: string | null): string {
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

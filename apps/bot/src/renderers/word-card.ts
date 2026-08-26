/**
 * The card a saved word renders as — the same grammar the live translate card
 * uses (`translation.renderer.ts`).
 *
 * Each stored-word surface used to own its layout, so the word a user had just
 * translated looked like a different product once it came back from the
 * dictionary or a notification: a `<i>word · 🇬🇧</i>` chrome line the translate
 * card never had, a source-usage block repeating the headword shown one line
 * above, synonyms on a line of their own instead of beside the word.
 *
 * The shapes here are asserted against `renderTranslation` itself in
 * `__tests__/word-card.test.ts`: a change to the translate card that this module
 * does not follow fails there rather than in a user's chat.
 */
import type { Example, SourceUsage, SupportedLang, Synonym } from "@polyglot/core";
import { getLangFlag, t } from "@polyglot/core";
import { esc, expandableSection } from "./card-sections.js";

/** One language's answer, as the card shows it. */
export interface WordCardLang {
  /** ISO 639-1 code; absent when the stored language row no longer resolves. */
  code?: string;
  text: string;
  synonyms?: readonly Synonym[];
  examples?: readonly Example[];
  usageNote?: string | null;
  connotationWarning?: string | null;
}

export interface WordCardData {
  original: string;
  emoji?: string | null;
  sourceLang?: string;
  /** Stored gloss of the word, written in the reader's own language. */
  nativeMeaning?: string | null;
  sourceUsage?: SourceUsage | null;
  /** Languages in display order — see `orderTranslations` / `orderRecordEntries`. */
  langs: readonly WordCardLang[];
  /**
   * The language whose block is the answer: it is promoted directly under the
   * headword, and its presence is what folds the stored prose below the examples.
   * The native language on every surface except SRS, where the answer is the
   * review's target language.
   */
  answerLang?: string;
  /** Language the stored prose is written in; labels it while it stays visible. */
  nativeLang?: string;
}

/**
 * The saved source block reduced to what a hidden-answer front may show: the
 * citation form and its source-language synonyms. Without this a front showed the
 * raw input ("arbeit") while its own back showed the citation form ("die Arbeit");
 * passing the whole block instead would leak the examples and the explanation,
 * whose native glosses are the answer the front is asking for.
 */
export function citationOnly(usage: SourceUsage | null | undefined): SourceUsage | undefined {
  return usage ? { headword: usage.headword, explanation: "", synonyms: usage.synonyms, examples: [] } : undefined;
}

function flagOf(code: string | undefined): string {
  return (code ? getLangFlag(code) : undefined) ?? "🔤";
}

/** `🇷🇺 RU:` — the label the translate card puts before every translation. */
function langLabel(code: string | undefined): string {
  return code ? `${flagOf(code)} ${esc(code.toUpperCase())}:` : flagOf(code);
}

function synonymSuffix(synonyms: readonly Synonym[] | undefined): string {
  return synonyms && synonyms.length > 0 ? ` (${synonyms.map((s) => esc(s.text)).join(", ")})` : "";
}

function exampleLine(example: Example): string {
  return `💬 <i>${esc(example.target)}</i>${example.native ? ` (${esc(example.native)})` : ""}`;
}

/** The first example stays visible under the word; the rest fold with the prose. */
function splitExamples(examples: readonly Example[] | undefined): { visible: string[]; folded: string[] } {
  const [first, ...rest] = (examples ?? []).map(exampleLine);
  return { visible: first ? [first] : [], folded: rest };
}

function langBlock(entry: WordCardLang, lang: SupportedLang): string[] {
  const lines = [`${langLabel(entry.code)} <b>${esc(entry.text)}</b>${synonymSuffix(entry.synonyms)}`];
  const { visible, folded } = splitExamples(entry.examples);
  lines.push(...visible);
  if (entry.usageNote) {
    folded.push(`💡 ${esc(entry.usageNote)}`);
  }
  if (entry.connotationWarning) {
    folded.push(t("connotationWarning", lang, { warning: esc(entry.connotationWarning) }));
  }
  lines.push(...expandableSection(folded));
  return lines;
}

export function renderWordCard(card: WordCardData, lang: SupportedLang): string {
  const usage = card.sourceUsage;
  // The canonical citation form when one was stored (German "die Arbeit" for the
  // input "arbeit"); the raw input stays in `original` for save/dedup.
  const headword = usage?.headword?.trim() ? usage.headword : card.original;
  const emoji = card.emoji ? `${esc(card.emoji)} ` : "";

  const answer = card.answerLang ? card.langs.find((entry) => entry.code === card.answerLang) : undefined;
  const others = card.langs.filter((entry) => entry !== answer);
  // One paragraph, never two. The stored explanation and the stored gloss describe
  // the same word at different lengths, and the translate card renders one or the
  // other — showing both put two walls of description between the headword and the
  // answer. The explanation wins because it is the fuller text.
  const prose = [usage?.explanation, card.nativeMeaning].find((text) => text?.trim());

  const sections: string[][] = [
    [`${emoji}${flagOf(card.sourceLang)} <b>${esc(headword)}</b>${synonymSuffix(usage?.synonyms)}`],
  ];

  // The stored prose is supplementary — and folds below the examples — whenever
  // the reader can already read the answer: either a block in their own language
  // is on the card, or the word is in their own language to begin with. Only when
  // neither holds is the prose itself the answer, and then it stays visible.
  const proseIsSupplementary =
    Boolean(answer) || (card.nativeLang !== undefined && card.nativeLang === card.sourceLang);

  // Always a note, never a language label: `🇷🇺 RU:` introduces a translation
  // everywhere else on the card, so wearing it made a paragraph of description
  // read as the answer the reader was looking for.
  const proseNote = prose ? `💡 ${esc(prose)}` : undefined;

  if (answer) {
    sections.push(langBlock(answer, lang));
  } else if (proseNote && !proseIsSupplementary) {
    sections.push([proseNote]);
  }

  const { visible, folded } = splitExamples(usage?.examples);
  if (proseNote && proseIsSupplementary) {
    folded.push(proseNote);
  }
  sections.push([...visible, ...expandableSection(folded)]);

  for (const entry of others) {
    sections.push(langBlock(entry, lang));
  }

  return sections
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n")
    .trim();
}

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
import type { CardFrontFields, Example, SourceUsage, SupportedLang, Synonym } from "@polyglot/core";
import { t } from "@polyglot/core";
import { answerLine, esc, exampleLine, expandableSection, headwordLine, meaningLine } from "./card-sections.js";

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

/** The saved word as a hidden-answer front needs it — nothing that carries the answer. */
export interface CardFrontWord {
  original: string;
  emoji?: string | null;
  sourceLang?: string;
  sourceUsage?: SourceUsage | null;
}

/**
 * The front of a review card: the citation form, plus whatever the user switched
 * on in card settings.
 *
 * Built from an allow-list rather than by trimming the back, because every field
 * left out of it is one that gives the answer away: the stored meaning and the
 * explanation are the answer in the reader's own language, and a saved example's
 * `native` gloss is its translation — so the example is shown bare.
 */
export function renderCardFront(word: CardFrontWord, fields: CardFrontFields): string {
  const usage = word.sourceUsage;
  // Without the citation form a front showed the raw input ("arbeit") while its
  // own back showed "die Arbeit".
  const headword = usage?.headword?.trim() ? usage.headword : word.original;
  const synonyms = fields.synonyms ? texts(usage?.synonyms) : [];
  const aids: string[] = [];
  const hint = usage?.recallHint?.trim();
  if (fields.hint && hint) aids.push(`🔎 <i>${esc(hint)}</i>`);
  const example = usage?.examples?.[0]?.target;
  if (fields.example && example) aids.push(exampleLine(example));

  const head = headwordLine(headword, { emoji: word.emoji, sourceLang: word.sourceLang, synonyms });
  return aids.length > 0 ? `${head}\n\n${aids.join("\n")}` : head;
}

/** Synonym rows carry `{ text }`; the shared atoms take bare strings. */
function texts(synonyms: readonly Synonym[] | undefined): readonly string[] {
  return (synonyms ?? []).map((synonym) => synonym.text);
}

/** The first example stays visible under the word; the rest fold with the prose. */
function splitExamples(examples: readonly Example[] | undefined): { visible: string[]; folded: string[] } {
  const [first, ...rest] = (examples ?? []).map((example) => exampleLine(example.target, example.native));
  return { visible: first ? [first] : [], folded: rest };
}

function langBlock(entry: WordCardLang, lang: SupportedLang): string[] {
  // Without a resolved language the text is still worth showing, but it is not an
  // answer: `🇷🇺 RU:` promises *this* language's word, and a label naming nothing
  // cannot. It drops to a note, which is what the card already does with prose it
  // cannot attribute. Synonyms go with the label — a note has no slot for them.
  const lines = [
    entry.code === undefined ? meaningLine(entry.text) : answerLine(entry.code, entry.text, texts(entry.synonyms)),
  ];
  const { visible, folded } = splitExamples(entry.examples);
  lines.push(...visible);
  if (entry.usageNote) {
    folded.push(meaningLine(entry.usageNote));
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

  // A block in the card's own language repeats the headword one line above it —
  // `🇨🇿 CS: Povzdech úlevy` under `🇨🇿 CS: Povzdech ulevy`. The translate card
  // drops it too (`translation.renderer.ts`); an unresolved block has no code and
  // stays, because it cannot be shown to duplicate anything.
  const sourceLang = card.sourceLang;
  const answers = sourceLang === undefined ? card.langs : card.langs.filter((entry) => entry.code !== sourceLang);
  const answer = card.answerLang ? answers.find((entry) => entry.code === card.answerLang) : undefined;
  const others = answers.filter((entry) => entry !== answer);
  // One paragraph, never two. The stored explanation and the stored gloss describe
  // the same word at different lengths, and the translate card renders one or the
  // other — showing both put two walls of description between the headword and the
  // answer. The explanation wins because it is the fuller text.
  const prose = [usage?.explanation, card.nativeMeaning].find((text) => text?.trim());

  const sections: string[][] = [
    [headwordLine(headword, { emoji: card.emoji, sourceLang: card.sourceLang, synonyms: texts(usage?.synonyms) })],
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
  const proseNote = prose ? meaningLine(prose) : undefined;

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

/**
 * The translation card, flattened into the text the mentor reads.
 *
 * The mentor answers a question about a card it never saw, so everything the
 * card shows — the headword, what it means, the per-language blocks and their
 * notes, plus the sections the user unfolded — travels with the question.
 * Without it the model re-derives the translation from the bare word and
 * answers about a different sense than the one on screen.
 *
 * Plain labelled lines rather than the card's HTML: flags, emoji and <b> tags
 * are Telegram's presentation, and the model needs the facts. English labels for
 * the same reason the mentor's system prompt is English — the answer's language
 * is settled there, and a label in a third language only muddies it.
 */
import type { Example, LanguageTranslation, Synonym, TranslateOutput } from "@polyglot/core";

/** What the session remembers about one card, as the mentor needs to see it. */
export interface CardMentorContext {
  output: TranslateOutput;
  /** Context the user typed alongside the word when asking for the translation. */
  contextHint?: string;
  /** Grammar breakdown unfolded on this card (language code → items). */
  grammarBreakdown?: Record<string, string[]>;
  /** Etymology prose unfolded on this card. */
  etymology?: string;
}

const listSynonyms = (synonyms: readonly Synonym[]): string => synonyms.map((synonym) => synonym.text).join(", ");

const formatExample = (example: Example): string =>
  example.native ? `"${example.target}" — ${example.native}` : `"${example.target}"`;

const listExamples = (examples: readonly Example[]): string => examples.map(formatExample).join(" / ");

/** One target-language block: the translation and every note the card carries for it. */
function describeTranslation(code: string, translation: LanguageTranslation): string[] {
  const synonyms = translation.synonyms.length > 0 ? ` (synonyms: ${listSynonyms(translation.synonyms)})` : "";
  const lines = [`Translation into ${code}: ${translation.text}${synonyms}`];

  for (const alternative of translation.alternatives ?? []) {
    const altSynonyms = alternative.synonyms.length > 0 ? ` (synonyms: ${listSynonyms(alternative.synonyms)})` : "";
    lines.push(`  alternative: ${alternative.text}${altSynonyms}`);
  }
  if (translation.expressionType) lines.push(`  expression type: ${translation.expressionType}`);
  if (translation.equivalentNote) lines.push(`  why this equivalent: ${translation.equivalentNote}`);
  if (translation.usageNote) lines.push(`  usage note: ${translation.usageNote}`);
  if (translation.connotationWarning) lines.push(`  caution: ${translation.connotationWarning}`);
  if (translation.examples.length > 0) lines.push(`  examples: ${listExamples(translation.examples)}`);

  return lines;
}

/**
 * The card as labelled lines. Absent fields render nothing at all rather than an
 * empty label — a line reading "usage note:" invites the model to invent one.
 */
export function renderCardForMentor(card: CardMentorContext): string {
  const { output } = card;
  const usage = output.sourceUsage;
  const headword = usage?.headword?.trim();

  const lines = [`Original input: ${output.original}`, `Source language: ${output.sourceLang}`];
  if (headword && headword !== output.original) lines.push(`Citation form: ${headword}`);
  if (output.correction) {
    lines.push(`Silently corrected before translating: ${output.correction.original} → ${output.correction.corrected}`);
  }
  if (output.nativeMeaning) lines.push(`Meaning in the user's native language: ${output.nativeMeaning}`);
  if (output.nativeSynonyms.length > 0) lines.push(`Native-language synonyms: ${listSynonyms(output.nativeSynonyms)}`);
  if (usage?.explanation) lines.push(`Usage explanation shown on the card: ${usage.explanation}`);
  if (usage && usage.synonyms.length > 0) lines.push(`Source-language synonyms: ${listSynonyms(usage.synonyms)}`);
  if (usage && usage.examples.length > 0) lines.push(`Source-language examples: ${listExamples(usage.examples)}`);

  for (const [code, translation] of Object.entries(output.translations)) {
    lines.push(...describeTranslation(code, translation));
  }

  for (const [code, items] of Object.entries(card.grammarBreakdown ?? {})) {
    if (items.length > 0) lines.push(`Grammar breakdown (${code}): ${items.join("; ")}`);
  }
  if (card.etymology) lines.push(`Etymology: ${card.etymology}`);
  if (card.contextHint) lines.push(`Context the user gave when asking for this translation: ${card.contextHint}`);
  if (output.unverified) {
    lines.push("Caveat: the source word was translated as written and is not a verified word of that language.");
  }

  return lines.join("\n");
}

/**
 * The whole turn: the card, then the question the user typed about it.
 *
 * The question comes last and is fenced by a label, so the model reads the card
 * as background and the question as the thing to answer — the reverse order
 * buries the ask under a screen of data.
 */
export function composeCardMentorTurn(card: CardMentorContext, question: string): string {
  return [
    "The user is looking at this translation card in the app:",
    "--- CARD ---",
    renderCardForMentor(card),
    "--- END OF CARD ---",
    "",
    "Their question about it:",
    question,
  ].join("\n");
}

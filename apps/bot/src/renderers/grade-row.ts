import { type I18nKey, type SupportedLang, t, type VocabDifficulty } from "@polyglot/core";
import type { InlineKeyboard } from "grammy";

/**
 * The three recall grades every surface offers (nudge, revealed card, flashcard).
 * They all write the same `difficulty` column, so they share one label set — a
 * grade that read differently on each surface would look like a different setting.
 */
export const DIFFICULTY_GRADES: ReadonlyArray<{ grade: VocabDifficulty; labelKey: I18nKey }> = [
  { grade: "hard", labelKey: "notifFbHard" },
  { grade: "normal", labelKey: "notifFbNormal" },
  { grade: "easy", labelKey: "notifFbEasy" },
];

/** `notif:fb:{grade}:{entryId}` — addressed by entry id, so it keeps working after the card's session state is gone. */
export function notifGradeCallback(grade: VocabDifficulty, entryId: number): string {
  return `notif:fb:${grade}:${entryId}`;
}

/** One row of grades; the chosen one wears a leading check so a later tap can still re-grade. */
export function appendGradeRow(
  kb: InlineKeyboard,
  lang: SupportedLang,
  callbackFor: (grade: VocabDifficulty) => string,
  selected?: VocabDifficulty | null,
): InlineKeyboard {
  for (const { grade, labelKey } of DIFFICULTY_GRADES) {
    const label = t(labelKey, lang);
    kb.text(grade === selected ? `✓ ${label}` : label, callbackFor(grade));
  }
  return kb;
}

// Below this a headword stops reading as a headline; a longer word breaks instead.
export const HEADLINE_MIN_SCALE = 0.7;

export function splitLastWord(text: string): { lead: string; tail: string } {
  const trimmed = text.trimEnd();
  const cut = trimmed.search(/\S+$/);
  return cut <= 0 ? { lead: "", tail: trimmed } : { lead: trimmed.slice(0, cut), tail: trimmed.slice(cut) };
}

/** Font scale that fits `needed` px of text into `available`; null when that would go below the floor. */
export function headlineScale(available: number, needed: number): number | null {
  if (needed <= available || available <= 0) return 1;
  // Floored to a hundredth so rounding never leaves the word a pixel too wide.
  const scale = Math.floor((available / needed) * 100) / 100;
  return scale >= HEADLINE_MIN_SCALE ? scale : null;
}

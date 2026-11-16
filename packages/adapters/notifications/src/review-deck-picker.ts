import { type CardsDeckCard, type SrsDueVocabularyCard } from "@polyglot/core";

export interface ReviewDeckPickerDeps {
  findDueForSrs(userId: number, now: Date, limit: number): Promise<SrsDueVocabularyCard[]>;
  findAheadForSrs(userId: number, now: Date, limit: number): Promise<SrsDueVocabularyCard[]>;
  /** Source of the practice-ahead shuffle; tests pin it. */
  random?: () => number;
}

/** Rows read per query. Ranking needs the whole dictionary in view, not a first page. */
const MAX_CANDIDATES = 1000;

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** One row per entry, first occurrence wins, so the repository's order survives. */
function uniqueByEntry(rows: readonly SrsDueVocabularyCard[], taken: ReadonlySet<number>): SrsDueVocabularyCard[] {
  const seen = new Set(taken);
  return rows.filter((row) => (seen.has(row.entryId) ? false : (seen.add(row.entryId), true)));
}

/**
 * The deck a card notification opens on.
 *
 * `history` is every word recently notified, newest first. Words absent from it come
 * first — due ones in SRS order, practice-ahead ones shuffled — then words already
 * sent, the one seen longest ago first. The last-sent word is never offered again.
 *
 * Ranking instead of a 24 h exclusion is the fix for one notification repeating for
 * days: the SRS order only moves when a word is graded, and a notification word is
 * often not graded (or graded "good" on an ahead card, which writes nothing), so a
 * short memory let the same one or two words lead every deck.
 */
export function createReviewDeckPicker(deps: ReviewDeckPickerDeps) {
  const random = deps.random ?? Math.random;

  return async function pickReviewDeck(
    userId: number,
    size: number,
    history: string[],
    now: Date = new Date(),
  ): Promise<CardsDeckCard[]> {
    const lastSent = history[0];
    const sentAge = new Map<string, number>();
    history.forEach((word, index) => {
      if (!sentAge.has(word)) sentAge.set(word, index);
    });

    const [dueRows, aheadRows] = await Promise.all([
      deps.findDueForSrs(userId, now, MAX_CANDIDATES),
      deps.findAheadForSrs(userId, now, MAX_CANDIDATES),
    ]);
    const allDue = uniqueByEntry(dueRows, new Set<number>());
    const notLast = (row: SrsDueVocabularyCard) => row.original !== lastSent;
    const due = allDue.filter(notLast);
    const ahead = uniqueByEntry(aheadRows, new Set(allDue.map((row) => row.entryId))).filter(notLast);

    const unsent = (row: SrsDueVocabularyCard) => !sentAge.has(row.original);
    const freshDue = due.filter(unsent);
    const freshAhead = shuffle(ahead.filter(unsent), random);
    const stalest = [...due, ...ahead]
      .filter((row) => !unsent(row))
      .sort((a, b) => (sentAge.get(b.original) ?? 0) - (sentAge.get(a.original) ?? 0));

    const dueIds = new Set(allDue.map((row) => row.entryId));
    return [...freshDue, ...freshAhead, ...stalest]
      .slice(0, size)
      .map(({ srsDueDate: _dueDate, ...row }) => ({ ...row, ahead: !dueIds.has(row.entryId) }));
  };
}

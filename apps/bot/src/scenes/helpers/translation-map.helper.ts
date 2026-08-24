import type { SessionData } from "../../types.js";
import { setEvictingEntry } from "../../utils/evicting-map.js";

/**
 * Maximum number of translation cards retained in the per-user session
 * {@link SessionData.translationMap}. Older cards are evicted once this cap is
 * exceeded (see {@link setTranslationEntry}).
 *
 * The session row is read and rewritten whole on every update (serialized by
 * grammy's sequentialize), so an unbounded map inflates every subsequent
 * request's storage round-trip. A heavy user translating for a long session
 * would otherwise accumulate thousands of cards. Capping keeps the row small;
 * the handful of most-recent cards are the only ones whose inline buttons a
 * user realistically taps. Accessing an evicted card falls through the existing
 * "session expired" guards on each callback handler.
 */
export const MAX_TRANSLATION_MAP_ENTRIES = 30;

/**
 * Maximum number of card inputs retained in {@link SessionData.cardWords}.
 *
 * An order of magnitude above {@link MAX_TRANSLATION_MAP_ENTRIES} on purpose: an
 * entry here is one short input string, not a whole translation output, so the
 * memory that makes an expired card recoverable costs a fraction of what the
 * card itself costs. It covers the reports that motivated it — buttons tapped on
 * cards far back in chat history.
 */
export const MAX_CARD_WORD_ENTRIES = 300;

type TranslationEntry = NonNullable<SessionData["translationMap"]>[string];
type CardWordEntry = NonNullable<SessionData["cardWords"]>[string];

/**
 * Stores a translation card in the session, evicting the least-recently-added
 * cards once the map exceeds {@link MAX_TRANSLATION_MAP_ENTRIES} (see
 * `setEvictingEntry` for why eviction is by insertion stamp, not message id).
 *
 * The card's input is mirrored into the longer-lived {@link SessionData.cardWords}
 * so eviction downgrades a card from "fully interactive" to "re-translatable"
 * rather than to a dead button.
 */
export function setTranslationEntry(
  session: SessionData,
  msgId: number,
  entry: TranslationEntry,
  maxEntries: number = MAX_TRANSLATION_MAP_ENTRIES,
): void {
  session.translationMap ??= {};
  setEvictingEntry(session.translationMap, msgId, entry, maxEntries);
  rememberCardWord(session, msgId, {
    word: entry.output.original,
    ...(entry.contextHint !== undefined && { contextHint: entry.contextHint }),
  });
}

function rememberCardWord(session: SessionData, msgId: number, entry: CardWordEntry): void {
  session.cardWords ??= {};
  setEvictingEntry(session.cardWords, msgId, entry, MAX_CARD_WORD_ENTRIES);
}

/** What a card was about, for cards whose full state is gone. Non-consuming: a user may tap twice. */
export function recallCardWord(session: SessionData, msgId: number | string): CardWordEntry | undefined {
  const entry = session.cardWords?.[String(msgId)];
  return entry?.word ? entry : undefined;
}

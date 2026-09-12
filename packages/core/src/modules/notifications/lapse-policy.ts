/**
 * Lapse policy — what the bot sends when a subscriber goes quiet.
 *
 * A lapse is a *change of content*, not an unsubscribe and not a countdown to
 * one. Past {@link INACTIVITY_DAYS} of silence the per-slot daily cards stop and
 * the user drops to one card every {@link REENGAGEMENT_INTERVAL_DAYS} — an
 * actual word, drawn from the curated preset set when their own dictionary has
 * nothing left to offer. It keeps going for as long as they stay away: the only
 * things that stop it are the user's own settings toggle and a Telegram 403.
 *
 * There is deliberately no ping cap. The earlier design sent four text nudges
 * and then went quiet forever, which turned "we have nothing new to say" into
 * "this person is unreachable" — and a curated word is content the user
 * subscribed to, not a nag that wears out.
 *
 * These numbers live in core because the repository builds the candidate query
 * from them and the scheduler paces against them; two copies would drift.
 */

/** Days of silence after which the per-slot daily cards stop and the lapse cadence begins. */
export const INACTIVITY_DAYS = 14;

/** Spacing between the word cards a lapsed subscriber receives. */
export const REENGAGEMENT_INTERVAL_DAYS = 5;

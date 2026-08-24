/**
 * Dates the way a reader says them out loud.
 *
 * `2026-09-22` is a machine's date: it reads as a serial number in the middle of a
 * sentence, and outside the ISO-using minority it is also ambiguous. Every date the
 * bot puts in front of a user goes through here instead, rendered by `Intl` in the
 * language the surrounding sentence is written in.
 */

/**
 * "22 сентября 2026 г." / "September 22, 2026" — `date` in `lang`, read in
 * `timeZone`.
 *
 * The zone is load-bearing, not decoration: a subscription bought at 00:30 local
 * time ends on an instant whose UTC calendar day is the previous one, so a
 * UTC-rendered date would tell the buyer their plan expires a day earlier than it
 * does. An unusable zone (a stale or hand-edited settings row) falls back to UTC
 * rather than throwing on a confirmation message.
 */
export function formatLongDate(date: Date, lang: string, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
  try {
    return new Intl.DateTimeFormat(lang, { ...options, timeZone: timeZone || "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat(lang, { ...options, timeZone: "UTC" }).format(date);
  }
}

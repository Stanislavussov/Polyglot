/**
 * Escapes user-supplied search terms before they are wrapped into a
 * `LIKE`/`ILIKE` pattern (S12).
 *
 * Without escaping, a literal `%` or `_` in a search term is interpreted as a
 * wildcard: `%` matches any run of characters and `_` matches any single one, so
 * a search for `50%` would match every row containing `50`, and a search could
 * be used to probe far more data than intended. Postgres treats backslash as the
 * default LIKE escape character, so we backslash-escape `\`, `%`, and `_` — the
 * term then matches only its literal characters.
 *
 * Callers still add their own `%…%` (or `%…`, `…%`) wildcards around the escaped
 * term; only the characters that came from the user are neutralised.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

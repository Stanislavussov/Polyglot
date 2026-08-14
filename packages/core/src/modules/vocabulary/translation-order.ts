/**
 * Translation display ordering.
 *
 * Every surface that lists a word's translations must show the languages in the
 * order the user chose them (native language first). Neither of the two carriers
 * the system used before is capable of holding that order:
 *
 * - **Object key order.** The bot session lives in a `jsonb` column, and Postgres
 *   normalizes `jsonb` object keys by (key length, then bytewise). Every
 *   ISO 639-1 code is two characters, so every key ties on length and the record
 *   always reads back **alphabetically**. Anything keyed by language code loses
 *   its order on the first session round-trip.
 * - **Row order.** The translation selects had no `ORDER BY`, so row order was
 *   plan-dependent and moved whenever a tuple was rewritten — which happens on
 *   every SRS review, because `srs_due_date` is indexed and the update is
 *   therefore not HOT-eligible.
 *
 * So order is not stored; it is **derived at the point of iteration**, from the
 * collection actually being rendered. That is why {@link orderRecordEntries}
 * takes the record itself rather than a precomputed list of codes: a caller
 * cannot pass an order that disagrees with the data it orders. Several callers
 * render strict subsets (a grammar breakdown covers only the languages that have
 * one), and a shared code list would silently drop or invent entries.
 *
 * {@link LanguageOrderContext} is opaque so that a bare `{ learningLangs: [] }`
 * cannot be conjured at a call site to satisfy the compiler — that value ranks
 * everything alphabetically, i.e. reproduces the original bug. This raises the
 * cost of the mistake; it does not make it impossible, so the real guarantee is
 * the per-surface tests asserting a non-alphabetical result.
 */

/**
 * Brand marking a context as genuinely built from a user's settings.
 *
 * A real symbol rather than a `declare`d one, so {@link createLanguageOrderContext}
 * can construct the value without a type assertion. It must be exported for the
 * emitted declarations to name it, but it carries no useful value on its own: the
 * context type also requires the precomputed `ranks` map, so re-creating one by
 * hand is strictly more work than calling the factory.
 */
export const ctxBrand: unique symbol = Symbol("languageOrderContext");

/**
 * The user's language preferences, in their own order.
 *
 * Opaque by construction — build it with {@link createLanguageOrderContext} from
 * values that came from the user's settings.
 */
export interface LanguageOrderContext {
  readonly [ctxBrand]: true;
  /** Rendered first when present. */
  readonly nativeLang?: string;
  /** Learning languages in the order the user selected them. */
  readonly learningLangs: readonly string[];
  /** code → rank, precomputed so ordering stays O(n log n) rather than O(n²). */
  readonly ranks: ReadonlyMap<string, number>;
}

/** Rank assigned to a language the user does not (or no longer) studies. */
function leftoverRank(learningLangsCount: number): number {
  return learningLangsCount + 1;
}

/**
 * Build an ordering context from the user's settings.
 *
 * A user who has not chosen any learning languages yields an empty context. That
 * is legitimate — there is genuinely nothing to order — and is not the same as
 * fabricating an empty context at a call site that *does* have settings available.
 */
export function createLanguageOrderContext(settings: {
  nativeLang?: string | null;
  learningLangs: readonly string[];
}): LanguageOrderContext {
  const nativeLang = settings.nativeLang ?? undefined;
  const ranks = new Map<string, number>();

  if (nativeLang) ranks.set(nativeLang, 0);
  settings.learningLangs.forEach((code, index) => {
    // The native language keeps rank 0 even if it also appears in learningLangs,
    // and a duplicate keeps its first position rather than being pushed later.
    if (!ranks.has(code)) ranks.set(code, index + 1);
  });

  return {
    [ctxBrand]: true,
    nativeLang,
    learningLangs: settings.learningLangs,
    ranks,
  };
}

/**
 * Rank of a language code: 0 for the native language, 1..n for learning languages
 * in the user's order, and one past the end for anything else.
 */
export function languageRank(code: string, ctx: LanguageOrderContext): number {
  return ctx.ranks.get(code) ?? leftoverRank(ctx.learningLangs.length);
}

/**
 * Compare two language codes. Falls back to the code itself so the ordering is
 * **total**: the result never depends on the order the input happened to arrive
 * in, which is the property that makes it immune to both `jsonb` key
 * normalization and plan-dependent row order.
 */
function compareCodes(a: string, b: string, ctx: LanguageOrderContext): number {
  const diff = languageRank(a, ctx) - languageRank(b, ctx);
  return diff !== 0 ? diff : a.localeCompare(b);
}

/**
 * Order a bare list of language codes.
 *
 * Used where a caller already holds codes rather than a record — for example the
 * grammar-detail keyboard, which filters to the languages that actually have a
 * breakdown before building buttons.
 */
export function orderLangCodes(codes: readonly string[], ctx: LanguageOrderContext): readonly string[] {
  return [...codes].sort((a, b) => compareCodes(a, b, ctx));
}

/**
 * Order the entries of a language-keyed record.
 *
 * Returns `[code, value]` pairs derived from the record itself, so the rendered
 * key set is exactly the record's key set — a caller cannot supply an order that
 * omits or invents a language.
 */
export function orderRecordEntries<V>(
  record: Readonly<Record<string, V>>,
  ctx: LanguageOrderContext,
): readonly (readonly [string, V])[] {
  return Object.entries(record).sort(([a], [b]) => compareCodes(a, b, ctx));
}

/**
 * Order translation rows coming from the database.
 *
 * Rows carry a language id rather than a code, so the caller supplies the
 * resolver it already uses for rendering. A row whose language cannot be resolved
 * (the `languages` row was removed) is ranked last rather than dropped — dropping
 * it would be a third, silent behaviour on top of the two that already exist.
 */
export function orderTranslations<T extends { targetLangId: number }>(
  rows: readonly T[],
  ctx: LanguageOrderContext,
  resolveCode: (id: number) => string | undefined,
): readonly T[] {
  const keyed = rows.map((row) => ({
    row,
    // Unresolvable ids share the leftover rank; the id keeps them mutually stable.
    code: resolveCode(row.targetLangId) ?? `￿${row.targetLangId}`,
  }));

  keyed.sort((a, b) => compareCodes(a.code, b.code, ctx));
  return keyed.map(({ row }) => row);
}

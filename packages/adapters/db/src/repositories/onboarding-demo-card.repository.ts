import type { TranslateOutput } from "@polyglot/core";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, ilike, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { escapeLikePattern } from "../like-escape.js";
import type { OnboardingDemoCard } from "../schema.js";
import { onboardingDemoCards } from "../schema.js";

/** Payload written by the warm-up script / a cache-miss live generation. */
export interface UpsertOnboardingDemoCardInput {
  sourceLang: string;
  nativeLang: string;
  headword: string;
  payload: TranslateOutput;
  sortOrder?: number;
}

/** Review-surface filters. Every field is optional narrowing; nothing is implied. */
export interface OnboardingDemoCardListFilters {
  page: number;
  limit: number;
  sourceLang?: string;
  nativeLang?: string;
  isActive?: boolean;
  /** Substring match on the headword. */
  search?: string;
}

/**
 * How much of the cache is actually servable. `cached - active` is the size of
 * the review backlog: rows that cost an AI call to generate but that the bot
 * still cannot serve.
 */
export interface OnboardingDemoCardCounts {
  cached: number;
  active: number;
}

export interface OnboardingDemoCardListResult {
  cards: OnboardingDemoCard[];
  /** Rows matching the filters (drives pagination). */
  total: number;
  page: number;
  limit: number;
  /** Whole-table counts, independent of the filters above. */
  counts: OnboardingDemoCardCounts;
}

function buildListWhere(filters: OnboardingDemoCardListFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.sourceLang) {
    conditions.push(eq(onboardingDemoCards.sourceLang, filters.sourceLang));
  }

  if (filters.nativeLang) {
    conditions.push(eq(onboardingDemoCards.nativeLang, filters.nativeLang));
  }

  if (filters.isActive !== undefined) {
    conditions.push(eq(onboardingDemoCards.isActive, filters.isActive));
  }

  const search = filters.search?.trim();
  if (search) {
    conditions.push(ilike(onboardingDemoCards.headword, `%${escapeLikePattern(search)}%`));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export const onboardingDemoCardRepository = {
  /**
   * Reviewed hook cards for a (learning language, native language) pair, in
   * keyboard order. Unreviewed rows are never served.
   */
  async findActive(sourceLang: string, nativeLang: string): Promise<OnboardingDemoCard[]> {
    const db = getDb();
    return db
      .select()
      .from(onboardingDemoCards)
      .where(
        and(
          eq(onboardingDemoCards.sourceLang, sourceLang),
          eq(onboardingDemoCards.nativeLang, nativeLang),
          eq(onboardingDemoCards.isActive, true),
        ),
      )
      .orderBy(asc(onboardingDemoCards.sortOrder), asc(onboardingDemoCards.id));
  },

  /**
   * A single reviewed card by its natural key. Returns null for an unknown or
   * an unreviewed row — the tap path must never render an unreviewed card.
   */
  async findOne(sourceLang: string, nativeLang: string, headword: string): Promise<OnboardingDemoCard | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(onboardingDemoCards)
      .where(
        and(
          eq(onboardingDemoCards.sourceLang, sourceLang),
          eq(onboardingDemoCards.nativeLang, nativeLang),
          eq(onboardingDemoCards.headword, headword),
          eq(onboardingDemoCards.isActive, true),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * Whether the triple already has a cached payload, reviewed or not. The
   * warm-up script uses this to skip work it has already done; `findOne` cannot
   * answer it because it deliberately hides unreviewed rows.
   */
  async hasCached(sourceLang: string, nativeLang: string, headword: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: onboardingDemoCards.id })
      .from(onboardingDemoCards)
      .where(
        and(
          eq(onboardingDemoCards.sourceLang, sourceLang),
          eq(onboardingDemoCards.nativeLang, nativeLang),
          eq(onboardingDemoCards.headword, headword),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  /**
   * Whole-table review state. Read by the warm-up script (so an operator can see
   * that generating cards did not make them servable) and surfaced on the review
   * page. Cheap: one aggregate row, no payloads.
   */
  async counts(): Promise<OnboardingDemoCardCounts> {
    const db = getDb();
    const rows = await db
      .select({
        // Postgres returns count() as bigint, which the driver hands back as a
        // *string*. `sql<number>` only asserts the type — it does not convert —
        // so these must be coerced or they travel to the UI as "3" and every
        // numeric comparison against them silently fails.
        cached: sql<string>`count(*)`,
        active: sql<string>`count(*) filter (where ${onboardingDemoCards.isActive})`,
      })
      .from(onboardingDemoCards);
    return { cached: Number(rows[0]?.cached ?? 0), active: Number(rows[0]?.active ?? 0) };
  },

  /**
   * The review surface: cached cards with their payloads, ACTIVE AND INACTIVE.
   * Deliberately unlike `findActive`/`findOne` — a reviewer has to read exactly
   * the rows the bot refuses to serve. Never use this on the tap path.
   */
  async list(filters: OnboardingDemoCardListFilters): Promise<OnboardingDemoCardListResult> {
    const db = getDb();
    const offset = (filters.page - 1) * filters.limit;
    const where = buildListWhere(filters);

    const query = db
      .select()
      .from(onboardingDemoCards)
      .$dynamic()
      .orderBy(
        asc(onboardingDemoCards.sourceLang),
        asc(onboardingDemoCards.nativeLang),
        asc(onboardingDemoCards.sortOrder),
        asc(onboardingDemoCards.id),
      )
      .limit(filters.limit)
      .offset(offset);

    // See `counts()` — bigint arrives as a string and must be coerced.
    const countQuery = db.select({ count: sql<string>`count(*)` }).from(onboardingDemoCards).$dynamic();

    const [cards, countRows, counts] = await Promise.all([
      where ? query.where(where) : query,
      where ? countQuery.where(where) : countQuery,
      this.counts(),
    ]);

    return {
      cards,
      total: Number(countRows[0]?.count ?? 0),
      page: filters.page,
      limit: filters.limit,
      counts,
    };
  },

  /**
   * The review step: publish (or un-publish) a cached card. Generation never
   * flips this flag — a card is only ever served after a human has looked at it,
   * because these are the first thing a new user sees. Returns false when the
   * triple has no cached row at all.
   */
  async setActive(sourceLang: string, nativeLang: string, headword: string, isActive: boolean): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .update(onboardingDemoCards)
      .set({ isActive })
      .where(
        and(
          eq(onboardingDemoCards.sourceLang, sourceLang),
          eq(onboardingDemoCards.nativeLang, nativeLang),
          eq(onboardingDemoCards.headword, headword),
        ),
      )
      .returning({ id: onboardingDemoCards.id });
    return rows.length > 0;
  },

  /**
   * Cache a rendered card. Re-running the warm-up refreshes the payload and the
   * ordering only — `isActive` is deliberately left untouched so regenerating a
   * card can never publish it behind the review step.
   */
  async upsert(input: UpsertOnboardingDemoCardInput): Promise<void> {
    const db = getDb();
    const sortOrder = input.sortOrder ?? 0;
    await db
      .insert(onboardingDemoCards)
      .values({
        sourceLang: input.sourceLang,
        nativeLang: input.nativeLang,
        headword: input.headword,
        payload: input.payload,
        sortOrder,
      })
      .onConflictDoUpdate({
        target: [onboardingDemoCards.sourceLang, onboardingDemoCards.nativeLang, onboardingDemoCards.headword],
        set: { payload: input.payload, sortOrder },
      });
  },
};

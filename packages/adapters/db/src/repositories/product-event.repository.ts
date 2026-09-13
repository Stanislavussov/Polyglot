import type { ProductEvent, RecordProductEventInput } from "@polyglot/core";
import { and, desc, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { productEvents } from "../schema.js";

const POSTGRES_UNDEFINED_TABLE = "42P01";

/**
 * A deploy can reach a database that has not been migrated yet. Analytics must
 * never be the thing that breaks a user's translation, so a missing table is
 * swallowed here exactly as `language-detection.repository` swallows it.
 */
function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const candidate = (err as { cause?: unknown }).cause ?? err;
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  return (candidate as { code?: unknown }).code === POSTGRES_UNDEFINED_TABLE;
}

/** One step of the purchase funnel: how many times it fired, and how many distinct people it reached. */
export interface ProductFunnelStep {
  event: ProductEvent;
  count: number;
  users: number;
}

/** An event split by its `context` — feature key, command, mode or plan, depending on the event. */
export interface ProductEventBreakdownRow {
  event: ProductEvent;
  context: string;
  count: number;
  users: number;
}

/** Daily funnel counts for the trend chart. */
export interface ProductEventDayRow {
  date: string;
  paywallShown: number;
  planSelected: number;
  planConfirmed: number;
}

const DAY_EXPR = sql<string>`to_char(${productEvents.createdAt}, 'YYYY-MM-DD')`;

function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * `count(distinct user_id)` ignores NULLs, so an anonymous event contributes to
 * `count` but not to `users` — which is the honest reading: it happened, and we
 * cannot say to whom.
 */
const DISTINCT_USERS = sql<number>`count(distinct ${productEvents.userId})::int`;
const TOTAL = sql<number>`count(*)::int`;

export const productEventRepository = {
  async record(input: RecordProductEventInput): Promise<void> {
    const db = getDb();
    try {
      await db.insert(productEvents).values({
        userId: input.userId,
        event: input.event,
        context: input.context,
        plan: input.plan,
      });
    } catch (err) {
      if (isMissingTableError(err)) {
        return;
      }
      throw err;
    }
  },

  /** Every event's totals over the window, so the funnel and its drop-offs read from one query. */
  async getTotals(days = 30): Promise<ProductFunnelStep[]> {
    const db = getDb();
    const rows = await db
      .select({ event: productEvents.event, count: TOTAL, users: DISTINCT_USERS })
      .from(productEvents)
      .where(gte(productEvents.createdAt, since(days)))
      .groupBy(productEvents.event)
      .orderBy(desc(TOTAL));
    return rows.map((row) => ({ event: row.event, count: row.count, users: row.users }));
  },

  /**
   * Totals split by `context` for the events whose context carries the meaning
   * (which feature, which command, which plan). Ordered by volume so the admin
   * table leads with what people actually do.
   */
  async getBreakdown(events: ProductEvent[], days = 30): Promise<ProductEventBreakdownRow[]> {
    if (events.length === 0) {
      return [];
    }
    const db = getDb();
    const rows = await db
      .select({
        event: productEvents.event,
        // A row written before its event carried a context still belongs somewhere.
        context: sql<string>`coalesce(${productEvents.context}, '—')`,
        count: TOTAL,
        users: DISTINCT_USERS,
      })
      .from(productEvents)
      .where(and(gte(productEvents.createdAt, since(days)), inArray(productEvents.event, events)))
      .groupBy(productEvents.event, productEvents.context)
      .orderBy(desc(TOTAL));
    return rows.map((row) => ({ event: row.event, context: row.context, count: row.count, users: row.users }));
  },

  /** The three funnel steps per day, newest first. */
  async getFunnelByDay(days = 30): Promise<ProductEventDayRow[]> {
    const db = getDb();
    const rows = await db
      .select({
        date: DAY_EXPR,
        paywallShown: sql<number>`count(*) filter (where ${productEvents.event} = 'paywall.shown')::int`,
        planSelected: sql<number>`count(*) filter (where ${productEvents.event} = 'plan.selected')::int`,
        planConfirmed: sql<number>`count(*) filter (where ${productEvents.event} = 'plan.confirmed')::int`,
      })
      .from(productEvents)
      .where(gte(productEvents.createdAt, since(days)))
      .groupBy(DAY_EXPR)
      .orderBy(desc(DAY_EXPR));
    return rows;
  },
};

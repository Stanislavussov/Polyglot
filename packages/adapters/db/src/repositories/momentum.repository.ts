import {
  activeDaysFromEvents,
  type EffortKind,
  type MomentumEventKind,
  type MomentumReplayEvent,
  type MomentumRepository,
  type MomentumSnapshot,
  type RecordMomentumEventInput,
} from "@polyglot/core";
import { and, asc, count, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { momentumEvents, userMomentum } from "../schema.js";

export type { EffortKind, MomentumEventKind } from "@polyglot/core";
export { EFFORT_KINDS } from "@polyglot/core";

export const momentumRepository: MomentumRepository = {
  async getSnapshot(userId: number): Promise<MomentumSnapshot | null> {
    const db = getDb();
    const rows = await db
      .select({
        score: userMomentum.score,
        scoredAt: userMomentum.scoredAt,
        lastSeenAt: userMomentum.lastSeenAt,
        lastPraiseAt: userMomentum.lastPraiseAt,
        lastRecoveryAt: userMomentum.lastRecoveryAt,
      })
      .from(userMomentum)
      .where(eq(userMomentum.userId, userId))
      .limit(1);

    return rows[0] ?? null;
  },

  async recordEvent(event: RecordMomentumEventInput): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .insert(momentumEvents)
      .values({
        userId: event.userId,
        kind: event.kind,
        weight: event.weight,
        occurredAt: event.occurredAt,
        dedupeKey: event.dedupeKey,
      })
      .onConflictDoNothing({ target: [momentumEvents.userId, momentumEvents.dedupeKey] })
      .returning({ id: momentumEvents.id });

    return rows.length > 0;
  },

  async applySnapshot(userId: number, patch: Partial<MomentumSnapshot> & { updatedAt: Date }): Promise<void> {
    const db = getDb();
    const set: Partial<typeof userMomentum.$inferInsert> = { updatedAt: patch.updatedAt };
    if (patch.score !== undefined) set.score = patch.score;
    if (patch.scoredAt !== undefined) set.scoredAt = patch.scoredAt;
    if (patch.lastSeenAt !== undefined) set.lastSeenAt = patch.lastSeenAt;
    if (patch.lastPraiseAt !== undefined) set.lastPraiseAt = patch.lastPraiseAt;
    if (patch.lastRecoveryAt !== undefined) set.lastRecoveryAt = patch.lastRecoveryAt;

    await db
      .insert(userMomentum)
      .values({
        userId,
        ...set,
        // The row's first `scored_at` comes from the caller's clock, never the column's
        // defaultNow(): a patch that only touches lastSeenAt would otherwise anchor the
        // decay curve to database time (§4.4).
        scoredAt: patch.scoredAt ?? patch.updatedAt,
      })
      .onConflictDoUpdate({ target: userMomentum.userId, set });
  },

  async sumWeightsForLocalDay(userId: number, kind: EffortKind, dayStart: Date, dayEnd: Date): Promise<number> {
    const db = getDb();
    const rows = await db
      // sum() over int4 comes back as bigint (a string over the wire); the cast keeps it a number.
      .select({ total: sql<number>`coalesce(sum(${momentumEvents.weight}), 0)::int` })
      .from(momentumEvents)
      .where(
        and(
          eq(momentumEvents.userId, userId),
          eq(momentumEvents.kind, kind),
          gte(momentumEvents.occurredAt, dayStart),
          lt(momentumEvents.occurredAt, dayEnd),
        ),
      );

    return rows[0]?.total ?? 0;
  },

  async countEventsSince(userId: number, kind: MomentumEventKind, since: Date): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ value: count() })
      .from(momentumEvents)
      .where(
        and(eq(momentumEvents.userId, userId), eq(momentumEvents.kind, kind), gte(momentumEvents.occurredAt, since)),
      );

    return rows[0]?.value ?? 0;
  },

  /**
   * Bucketed in JS by `activeDaysFromEvents` rather than by `(occurred_at AT TIME ZONE tz)::date`:
   * the same helper already keys the dedupe keys and the daily caps, and it falls back to UTC on
   * the stale/garbage timezone strings user rows carry, where Postgres would raise `invalid_parameter_value`.
   * The scan is bounded — one user's journal is pruned at 90 days.
   */
  /** The kind sits between the two colons of `praise:<kind>[:<localDay>]` (see `momentum.service.ts`). */
  async listPraisedKinds(userId: number): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .selectDistinct({ praiseKind: sql<string>`split_part(${momentumEvents.dedupeKey}, ':', 2)` })
      .from(momentumEvents)
      .where(and(eq(momentumEvents.userId, userId), eq(momentumEvents.kind, "praise")));

    return rows.map((row) => row.praiseKind);
  },

  async countActiveDays(userId: number, since: Date, timezone: string): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ occurredAt: momentumEvents.occurredAt, weight: momentumEvents.weight })
      .from(momentumEvents)
      .where(and(eq(momentumEvents.userId, userId), gte(momentumEvents.occurredAt, since)));

    return activeDaysFromEvents(rows, timezone, since);
  },

  async listEventsForReplay(userId: number): Promise<MomentumReplayEvent[]> {
    const db = getDb();
    return db
      .select({
        kind: momentumEvents.kind,
        weight: momentumEvents.weight,
        occurredAt: momentumEvents.occurredAt,
      })
      .from(momentumEvents)
      .where(eq(momentumEvents.userId, userId))
      .orderBy(asc(momentumEvents.occurredAt), asc(momentumEvents.id));
  },
};

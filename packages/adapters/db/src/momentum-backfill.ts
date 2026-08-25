/**
 * Momentum backfill — replay semantics (Task 81, plan §3.9).
 *
 * Historical effort lives in tables the motivation layer never wrote to
 * (`word_review_log`, `vocabulary_entries`, `translation_requests`), so a user who
 * was active before Slice 1 shipped would otherwise start at zero. This script
 * writes the missing journal rows with the same deterministic dedupe keys as the
 * live path, then recomputes the snapshot by replaying **all** of the user's
 * `momentum_events` — live rows included. Replay, not "sum the historical rows":
 * a naive implementation run after a week of live recording would overwrite the
 * live score with a smaller one. `applyEffort` is commutative (§3.3), so the replay
 * lands on exactly the value incremental recording would have produced, and a
 * re-run changes nothing.
 *
 * It lives in the adapter rather than the bot so it is exercised by the db
 * integration lane without a bot harness.
 */
import {
  applyEffort,
  cappedWeight,
  type EffortKind,
  errorFields,
  localDayBounds,
  localDayKey,
  logEvent,
} from "@polyglot/core";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "./connection.js";
import { momentumRepository } from "./repositories/momentum.repository.js";
import { translationRequests, userLanguageSettings, vocabularyEntries, wordReviewLog } from "./schema.js";

export interface MomentumBackfillOptions {
  now?: () => Date;
  /** Restrict the run to these users; omitted means every user carrying any source row. */
  userIds?: number[];
}

export interface MomentumBackfillResult {
  users: number;
  events: number;
}

interface SourceFact {
  kind: EffortKind;
  dedupeKey: string;
  occurredAt: Date;
}

/**
 * `recordAiUsage` (`apps/bot/src/utils/ai-quota.ts`) writes non-translation AI calls
 * — video, mentor, word-pick, dictionary-translate — into the same billing ledger with
 * `original` set to `[${callType}]`, and crediting those as translations would inflate
 * the score and the §3.6 calibration alike.
 *
 * The plan forbids this discriminator on the live path, and rightly: parsing another
 * module's formatting is a dependency nothing enforces. It is admissible here because
 * this is a one-shot historical script — no runtime code depends on the match, and a
 * future `callType` rename can only affect a re-run of a script that has already run.
 */
const BILLING_MARKER = /^\[[a-zA-Z]+\]$/;

async function collectUserIds(db: ReturnType<typeof getDb>, userIds?: number[]): Promise<number[]> {
  if (userIds) return [...new Set(userIds)];

  const [reviewers, savers, translators] = await Promise.all([
    db.selectDistinct({ userId: wordReviewLog.userId }).from(wordReviewLog),
    db.selectDistinct({ userId: vocabularyEntries.userId }).from(vocabularyEntries),
    db.selectDistinct({ userId: translationRequests.userId }).from(translationRequests),
  ]);

  return [...new Set([...reviewers, ...savers, ...translators].map((row) => row.userId))].sort((a, b) => a - b);
}

async function loadTimezones(db: ReturnType<typeof getDb>, userIds: number[]): Promise<Map<number, string>> {
  const rows = await db
    .select({ userId: userLanguageSettings.userId, timezone: userLanguageSettings.timezone })
    .from(userLanguageSettings)
    .where(inArray(userLanguageSettings.userId, userIds));

  return new Map(rows.map((row) => [row.userId, row.timezone]));
}

async function collectFacts(
  db: ReturnType<typeof getDb>,
  userId: number,
  timezone: string,
): Promise<ReadonlyArray<SourceFact>> {
  const [reviews, saves, translations] = await Promise.all([
    db
      .select({ entryId: wordReviewLog.entryId, reviewedAt: wordReviewLog.reviewedAt })
      .from(wordReviewLog)
      .where(eq(wordReviewLog.userId, userId)),
    db
      .select({ id: vocabularyEntries.id, createdAt: vocabularyEntries.createdAt })
      .from(vocabularyEntries)
      .where(eq(vocabularyEntries.userId, userId)),
    db
      .select({
        id: translationRequests.id,
        original: translationRequests.original,
        createdAt: translationRequests.createdAt,
      })
      .from(translationRequests)
      .where(eq(translationRequests.userId, userId)),
  ]);

  const facts: SourceFact[] = [
    ...reviews.map((row) => ({
      kind: "review" as const,
      dedupeKey: `review:${row.entryId}:${localDayKey(timezone, row.reviewedAt)}`,
      occurredAt: row.reviewedAt,
    })),
    ...saves.map((row) => ({
      kind: "save" as const,
      dedupeKey: `save:${row.id}`,
      occurredAt: row.createdAt,
    })),
    ...translations
      .filter((row) => !BILLING_MARKER.test(row.original))
      .map((row) => ({
        kind: "translate" as const,
        dedupeKey: `translate:${row.id}`,
        occurredAt: row.createdAt,
      })),
  ];

  return facts.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

/**
 * Caps are read once per (kind, local day) and then tracked in memory. Acknowledged
 * limitation (§3.4): a run racing the live bot reads the same day's sum and can exceed
 * the cap by a few points — bounded to one kind on one day, and the backfill runs once.
 */
async function backfillFacts(userId: number, timezone: string, facts: ReadonlyArray<SourceFact>): Promise<number> {
  const spentByDay = new Map<string, number>();
  let inserted = 0;

  for (const fact of facts) {
    const day = localDayKey(timezone, fact.occurredAt);
    const bucket = `${fact.kind}:${day}`;
    let spent = spentByDay.get(bucket);
    if (spent === undefined) {
      const { start, end } = localDayBounds(timezone, fact.occurredAt);
      spent = await momentumRepository.sumWeightsForLocalDay(userId, fact.kind, start, end);
    }

    const weight = cappedWeight(fact.kind, spent);
    const landed = await momentumRepository.recordEvent({
      userId,
      kind: fact.kind,
      weight,
      occurredAt: fact.occurredAt,
      dedupeKey: fact.dedupeKey,
    });

    spentByDay.set(bucket, landed ? spent + weight : spent);
    if (landed) inserted += 1;
  }

  return inserted;
}

async function recomputeSnapshot(userId: number, now: Date): Promise<void> {
  const events = await momentumRepository.listEventsForReplay(userId);
  const first = events[0];
  if (!first) return;

  let state = { score: 0, scoredAt: first.occurredAt };
  for (const event of events) {
    state = applyEffort(state, event.weight, event.occurredAt);
  }

  // lastSeenAt / lastPraiseAt / lastRecoveryAt stay untouched: they record what the user
  // was shown, which a replay of effort knows nothing about.
  await momentumRepository.applySnapshot(userId, { score: state.score, scoredAt: state.scoredAt, updatedAt: now });
}

export async function runMomentumBackfill(opts: MomentumBackfillOptions = {}): Promise<MomentumBackfillResult> {
  const db = getDb();
  const clock = opts.now ?? (() => new Date());

  const userIds = await collectUserIds(db, opts.userIds);
  if (userIds.length === 0) {
    logEvent("momentum.backfill_finished", { users: 0, events: 0 });
    return { users: 0, events: 0 };
  }

  const timezones = await loadTimezones(db, userIds);
  let users = 0;
  let events = 0;

  for (const userId of userIds) {
    try {
      const timezone = timezones.get(userId) ?? "UTC";
      const facts = await collectFacts(db, userId, timezone);
      events += await backfillFacts(userId, timezone, facts);
      await recomputeSnapshot(userId, clock());
      users += 1;
    } catch (err) {
      // One unreadable user must not cost the whole run its progress; the rest are independent.
      logEvent("momentum.recompute_failed", { userId, ...errorFields(err) }, "error");
    }
  }

  logEvent("momentum.backfill_finished", { users, events });
  return { users, events };
}

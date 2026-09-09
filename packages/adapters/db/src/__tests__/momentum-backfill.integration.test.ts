/**
 * Momentum backfill — real-DB integration tests (Task 81, plan §3.9, §8.2.2).
 *
 * The properties under test are all about interaction with rows that already exist:
 * which source rows become journal entries and which are skipped, that a run after a
 * week of live recording replays the full journal instead of overwriting it, that a
 * second run is inert, and that the daily cap applies to backfilled facts too. None
 * of that is observable against a mocked query builder.
 *
 * Every test provisions its own user through `uniqueTelegramId()` and scopes its reads
 * to that user, so parallel workers cannot see each other's rows.
 */
import { applyEffort, createMomentumService, DEFAULT_MOTIVATION_CONFIG, decay } from "@polyglot/core";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { runMomentumBackfill } from "../momentum-backfill.js";
import { languageRepository } from "../repositories/language.repository.js";
import { momentumRepository } from "../repositories/momentum.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import { momentumEvents, translationRequests, vocabularyEntries, wordReviewLog } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

async function freshUserId(): Promise<number> {
  const user = await userRepository.create({ telegramId: uniqueTelegramId(), username: "momentum-backfill-test" });
  return user.id;
}

async function langId(code: string): Promise<number> {
  const lang = await languageRepository.findByCode(code);
  if (!lang) throw new Error(`Expected seeded language '${code}' to exist on the migrated branch`);
  return lang.id;
}

/** Chronological, the order the backfill itself walks the facts in. */
async function journalOf(userId: number): Promise<Array<{ kind: string; weight: number; dedupeKey: string }>> {
  return getDb()
    .select({ kind: momentumEvents.kind, weight: momentumEvents.weight, dedupeKey: momentumEvents.dedupeKey })
    .from(momentumEvents)
    .where(eq(momentumEvents.userId, userId))
    .orderBy(asc(momentumEvents.occurredAt), asc(momentumEvents.id));
}

async function seedEntry(userId: number, sourceLangId: number, original: string, createdAt: Date): Promise<number> {
  const [row] = await getDb()
    .insert(vocabularyEntries)
    .values({ userId, original, sourceLangId, createdAt, updatedAt: createdAt })
    .returning({ id: vocabularyEntries.id });
  if (!row) throw new Error("Failed to seed a vocabulary entry");
  return row.id;
}

async function seedReview(userId: number, entryId: number, reviewedAt: Date): Promise<void> {
  await getDb().insert(wordReviewLog).values({ userId, entryId, sessionType: "flashcard", reviewedAt });
}

async function seedTranslationRequest(userId: number, original: string, createdAt: Date): Promise<number> {
  const [row] = await getDb()
    .insert(translationRequests)
    .values({ userId, original, createdAt })
    .returning({ id: translationRequests.id });
  if (!row) throw new Error("Failed to seed a translation request");
  return row.id;
}

describe("runMomentumBackfill (integration)", () => {
  it("credits reviews, saves and real translations while skipping the billing marker rows", async () => {
    const userId = await freshUserId();
    const de = await langId("de");
    const now = new Date("2026-03-10T12:00:00.000Z");

    const firstSave = new Date("2026-03-01T09:00:00.000Z");
    const secondSave = new Date("2026-03-02T09:00:00.000Z");
    const entryA = await seedEntry(userId, de, "Haus", firstSave);
    const entryB = await seedEntry(userId, de, "Baum", secondSave);

    const reviewA = new Date("2026-03-03T10:00:00.000Z");
    const reviewB = new Date("2026-03-04T10:00:00.000Z");
    await seedReview(userId, entryA, reviewA);
    await seedReview(userId, entryB, reviewB);

    const translationAt = new Date("2026-03-05T11:00:00.000Z");
    const requestId = await seedTranslationRequest(userId, "Guten Morgen", translationAt);
    // What `recordAiUsage` writes for a mentor turn — same ledger, not a translation.
    await seedTranslationRequest(userId, "[mentor]", new Date("2026-03-05T11:05:00.000Z"));

    const result = await runMomentumBackfill({ userIds: [userId], now: () => now });

    expect(result).toEqual({ users: 1, events: 5 });
    expect(await journalOf(userId)).toEqual([
      { kind: "save", weight: 2, dedupeKey: `save:${entryA}` },
      { kind: "save", weight: 2, dedupeKey: `save:${entryB}` },
      { kind: "review", weight: 3, dedupeKey: `review:${entryA}:2026-03-03` },
      { kind: "review", weight: 3, dedupeKey: `review:${entryB}:2026-03-04` },
      { kind: "translate", weight: 1, dedupeKey: `translate:${requestId}` },
    ]);

    const expected = [
      { weight: 2, at: firstSave },
      { weight: 2, at: secondSave },
      { weight: 3, at: reviewA },
      { weight: 3, at: reviewB },
      { weight: 1, at: translationAt },
    ].reduce((state, step) => applyEffort(state, step.weight, step.at), { score: 0, scoredAt: firstSave });

    const snapshot = await momentumRepository.getSnapshot(userId);
    expect(snapshot?.score).toBeCloseTo(expected.score, 9);
    expect(snapshot?.scoredAt.toISOString()).toBe(expected.scoredAt.toISOString());
  });

  it("does not lower the score of a user the bot has already been recording for a week", async () => {
    const userId = await freshUserId();
    const de = await langId("de");
    const liveStart = new Date("2026-04-01T09:00:00.000Z");
    const now = new Date("2026-04-08T09:00:00.000Z");

    // A week of live recording: one translate per day through the service, so the caps and
    // the snapshot are written exactly the way the running bot writes them.
    for (let day = 0; day < 7; day += 1) {
      const at = new Date(liveStart.getTime() + day * 24 * 60 * 60 * 1000);
      const service = createMomentumService({
        momentumRepository,
        getMotivationConfig: async () => DEFAULT_MOTIVATION_CONFIG,
        getTimezone: async () => "UTC",
        now: () => at,
      });
      await service.record({ userId, kind: "translate", dedupeKey: `translate:live:${day}`, occurredAt: at });
    }

    const before = await momentumRepository.getSnapshot(userId);
    if (!before) throw new Error("Expected the live recording to have produced a snapshot");
    const liveScoreAtNow = decay(before.score, before.scoredAt, now);
    expect(liveScoreAtNow).toBeGreaterThan(0);

    // Historical facts older than the live window — the case the naive "recompute from the
    // source tables" implementation would have overwritten the live score with.
    const entryId = await seedEntry(userId, de, "Fenster", new Date("2026-03-20T08:00:00.000Z"));
    await seedReview(userId, entryId, new Date("2026-03-21T08:00:00.000Z"));

    await runMomentumBackfill({ userIds: [userId], now: () => now });

    const after = await momentumRepository.getSnapshot(userId);
    if (!after) throw new Error("Expected a snapshot after the backfill");
    expect(decay(after.score, after.scoredAt, now)).toBeGreaterThanOrEqual(liveScoreAtNow);
  });

  it("is idempotent: a second run adds no rows and leaves the snapshot identical", async () => {
    const userId = await freshUserId();
    const de = await langId("de");
    const now = new Date("2026-05-10T12:00:00.000Z");

    const entryId = await seedEntry(userId, de, "Katze", new Date("2026-05-01T09:00:00.000Z"));
    await seedReview(userId, entryId, new Date("2026-05-02T09:00:00.000Z"));
    await seedTranslationRequest(userId, "Wie geht es dir", new Date("2026-05-03T09:00:00.000Z"));

    const first = await runMomentumBackfill({ userIds: [userId], now: () => now });
    const firstJournal = await journalOf(userId);
    const firstSnapshot = await momentumRepository.getSnapshot(userId);

    const second = await runMomentumBackfill({ userIds: [userId], now: () => now });

    expect(first.events).toBe(3);
    expect(second.events).toBe(0);
    expect(await journalOf(userId)).toEqual(firstJournal);
    const secondSnapshot = await momentumRepository.getSnapshot(userId);
    expect(secondSnapshot?.score).toBe(firstSnapshot?.score);
    expect(secondSnapshot?.scoredAt.toISOString()).toBe(firstSnapshot?.scoredAt.toISOString());
  });

  it("applies the daily review cap to backfilled facts: five reviews on one local day give 3, 3, 0, 0, 0", async () => {
    const userId = await freshUserId();
    const de = await langId("de");
    const now = new Date("2026-06-10T12:00:00.000Z");

    const savedAt = new Date("2026-06-01T06:00:00.000Z");
    const entryIds: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      entryIds.push(await seedEntry(userId, de, `Wort-${index}-${userId}`, savedAt));
    }
    for (const [index, entryId] of entryIds.entries()) {
      await seedReview(userId, entryId, new Date(`2026-06-02T0${index}:00:00.000Z`));
    }

    await runMomentumBackfill({ userIds: [userId], now: () => now });

    const reviewWeights = (await journalOf(userId)).filter((row) => row.kind === "review").map((row) => row.weight);

    expect(reviewWeights).toEqual([3, 3, 0, 0, 0]);
  });
});

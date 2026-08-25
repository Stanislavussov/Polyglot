/**
 * Spec for the momentum service (plan §3.4, §3.8, §4.3, §4.6, §8.2.1).
 *
 * Driven through an in-memory repository rather than call-count assertions: what
 * matters is the state a replayed update leaves behind, not how many times a method
 * was reached.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { MomentumRepository, RecordMomentumEventInput } from "../../../ports/momentum.repository.js";
import { activeDaysFromEvents, localDayKey } from "../momentum.math.js";
import { createMomentumService } from "../momentum.service.js";
import { DEFAULT_MOTIVATION_CONFIG, type MomentumSnapshot, type MotivationConfig } from "../momentum.types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface FakeRepository extends MomentumRepository {
  events: RecordMomentumEventInput[];
  snapshots: Map<number, MomentumSnapshot>;
}

function createFakeRepository(): FakeRepository {
  const events: RecordMomentumEventInput[] = [];
  const snapshots = new Map<number, MomentumSnapshot>();

  return {
    events,
    snapshots,
    async getSnapshot(userId) {
      return snapshots.get(userId) ?? null;
    },
    async recordEvent(event) {
      if (events.some((e) => e.userId === event.userId && e.dedupeKey === event.dedupeKey)) return false;
      events.push(event);
      return true;
    },
    async applySnapshot(userId, patch) {
      const current = snapshots.get(userId) ?? {
        score: 0,
        scoredAt: patch.updatedAt,
        lastSeenAt: null,
        lastPraiseAt: null,
        lastRecoveryAt: null,
      };
      const { updatedAt: _updatedAt, ...fields } = patch;
      snapshots.set(userId, { ...current, ...fields });
    },
    async sumWeightsForLocalDay(userId, kind, dayStart, dayEnd) {
      return events
        .filter(
          (e) =>
            e.userId === userId &&
            e.kind === kind &&
            e.occurredAt.getTime() >= dayStart.getTime() &&
            e.occurredAt.getTime() < dayEnd.getTime(),
        )
        .reduce((sum, e) => sum + e.weight, 0);
    },
    async countEventsSince(userId, kind, since) {
      return events.filter((e) => e.userId === userId && e.kind === kind && e.occurredAt >= since).length;
    },
    async countActiveDays(userId, since, timezone) {
      return activeDaysFromEvents(
        events.filter((e) => e.userId === userId),
        timezone,
        since,
      );
    },
    async listEventsForReplay(userId) {
      return events
        .filter((e) => e.userId === userId)
        .map((e) => ({ kind: e.kind, weight: e.weight, occurredAt: e.occurredAt }));
    },
  };
}

const USER_ID = 501;
const NOW = new Date("2026-08-20T12:00:00.000Z");

let repo: FakeRepository;
let config: MotivationConfig;

function createService(now = () => NOW) {
  return createMomentumService({
    momentumRepository: repo,
    getMotivationConfig: async () => config,
    getTimezone: async () => "Europe/Berlin",
    now,
  });
}

beforeEach(() => {
  repo = createFakeRepository();
  config = { ...DEFAULT_MOTIVATION_CONFIG };
});

describe("record", () => {
  it("writes nothing at all while recording is off", async () => {
    config.recordingEnabled = false;
    const service = createService();

    const result = await service.record({ userId: USER_ID, kind: "translate", dedupeKey: "translate:1" });

    expect(result).toEqual({ inserted: false, weight: 0 });
    expect(repo.events).toHaveLength(0);
    expect(repo.snapshots.size).toBe(0);
  });

  it("leaves the snapshot untouched while recording is off, marks included", async () => {
    config.recordingEnabled = false;
    config.recoveryEnabled = true;
    const service = createService();

    await service.touchSeen(USER_ID);
    await service.markSeen(USER_ID);
    await service.markRecoveryShown(USER_ID);

    // The marks write only to the snapshot, so nothing else would stop them from
    // creating a `user_momentum` row for a bot whose recording is switched off (§4.6).
    expect(await service.markPraiseShown(USER_ID, "mature_word")).toBe(false);
    expect(repo.events).toHaveLength(0);
    expect(repo.snapshots.size).toBe(0);
  });

  it("credits a replayed update once — the second attempt leaves the score untouched", async () => {
    const service = createService();

    const first = await service.record({ userId: USER_ID, kind: "save", dedupeKey: "save:42" });
    const replay = await service.record({ userId: USER_ID, kind: "save", dedupeKey: "save:42" });

    expect(first).toEqual({ inserted: true, weight: 2 });
    expect(replay.inserted).toBe(false);
    expect(repo.events).toHaveLength(1);
    expect(repo.snapshots.get(USER_ID)?.score).toBe(2);
  });

  it("spends the daily cap as weight and still writes the exhausted row", async () => {
    const service = createService();

    const weights: number[] = [];
    for (let i = 0; i < 4; i++) {
      const { weight } = await service.record({ userId: USER_ID, kind: "translate", dedupeKey: `translate:${i}` });
      weights.push(weight);
    }

    expect(weights).toEqual([1, 1, 1, 0]);
    expect(repo.events).toHaveLength(4);
    expect(repo.snapshots.get(USER_ID)?.score).toBe(3);
  });

  it("starts a new local day with a fresh cap, using the user's timezone", async () => {
    // 23:30Z is already tomorrow in Berlin, so these two land in different local days.
    const beforeMidnight = new Date("2026-07-01T21:30:00.000Z");
    const afterMidnight = new Date("2026-07-01T23:30:00.000Z");
    const service = createService();

    for (let i = 0; i < 3; i++) {
      await service.record({
        userId: USER_ID,
        kind: "translate",
        dedupeKey: `translate:early:${i}`,
        occurredAt: beforeMidnight,
      });
    }
    const nextDay = await service.record({
      userId: USER_ID,
      kind: "translate",
      dedupeKey: "translate:late",
      occurredAt: afterMidnight,
    });

    expect(nextDay).toEqual({ inserted: true, weight: 1 });
  });

  it("never caps mature", async () => {
    const service = createService();

    const result = await service.record({ userId: USER_ID, kind: "mature", dedupeKey: "mature:9" });

    expect(result).toEqual({ inserted: true, weight: 10 });
  });
});

describe("getSnapshot", () => {
  it("discounts the stored score to the moment of reading without writing", async () => {
    const service = createService();
    await service.record({
      userId: USER_ID,
      kind: "review",
      dedupeKey: "review:1",
      occurredAt: new Date(NOW.getTime() - 7 * DAY_MS),
    });
    const view = await service.getSnapshot(USER_ID);

    expect(view.score).toBeCloseTo(1.5, 9);
    expect(view.band).toBe("resting");
    // The read must not persist the discounted value — scoredAt still points at the event.
    expect(repo.snapshots.get(USER_ID)?.score).toBe(3);
  });

  it("reports an empty state for a user who has never been recorded", async () => {
    const view = await createService().getSnapshot(USER_ID);

    expect(view).toMatchObject({ score: 0, band: "resting", lastSeenAt: null });
  });
});

describe("recovery", () => {
  beforeEach(() => {
    config.recoveryEnabled = true;
  });

  it("shows nothing for a user we have never seen, and markSeen initializes them", async () => {
    const service = createService();

    expect(await service.decideRecovery(USER_ID)).toEqual({ show: false });

    await service.markSeen(USER_ID);
    expect(repo.snapshots.get(USER_ID)?.lastSeenAt).toEqual(NOW);
  });

  it("shows the line after a pause of a week or more, but not for yesterday's user", async () => {
    const service = createService();

    await service.markSeen(USER_ID, new Date(NOW.getTime() - DAY_MS));
    expect(await service.decideRecovery(USER_ID)).toEqual({ show: false });

    await service.markSeen(USER_ID, new Date(NOW.getTime() - 9 * DAY_MS));
    expect(await service.decideRecovery(USER_ID)).toEqual({ show: true, gapDays: 9 });
  });

  it("stays silent while the kill switch is off", async () => {
    config.recoveryEnabled = false;
    const service = createService();
    await service.markSeen(USER_ID, new Date(NOW.getTime() - 9 * DAY_MS));

    expect(await service.decideRecovery(USER_ID)).toEqual({ show: false });
  });

  it("keeps lastSeenAt stale until the pending line is actually shown", async () => {
    const service = createService();
    const nineDaysAgo = new Date(NOW.getTime() - 9 * DAY_MS);
    await service.markSeen(USER_ID, nineDaysAgo);

    // An intermediate screen with nowhere to render the line must not burn the chance.
    await service.touchSeen(USER_ID);
    expect(repo.snapshots.get(USER_ID)?.lastSeenAt).toEqual(nineDaysAgo);
    expect(await service.decideRecovery(USER_ID)).toEqual({ show: true, gapDays: 9 });

    await service.markRecoveryShown(USER_ID);
    expect(repo.snapshots.get(USER_ID)?.lastSeenAt).toEqual(NOW);
    expect(await service.decideRecovery(USER_ID)).toEqual({ show: false });
  });

  it("advances lastSeenAt on a touch when no line is pending", async () => {
    const service = createService();
    await service.markSeen(USER_ID, new Date(NOW.getTime() - DAY_MS));

    await service.touchSeen(USER_ID);

    expect(repo.snapshots.get(USER_ID)?.lastSeenAt).toEqual(NOW);
  });

  it("does not show a second line within a week of the last one", async () => {
    const service = createService();
    await service.markRecoveryShown(USER_ID, new Date(NOW.getTime() - 3 * DAY_MS));
    await service.markSeen(USER_ID, new Date(NOW.getTime() - 9 * DAY_MS));

    expect(await service.decideRecovery(USER_ID)).toEqual({ show: false });
  });
});

describe("praise", () => {
  const evidence = { dictionaryCount: 12, matureCount: 3, matureCrossedNow: { translationId: 7 } };

  beforeEach(() => {
    config.praiseEnabled = true;
  });

  it("reports the kill switch as a suppression reason so the counter can see it", async () => {
    config.praiseEnabled = false;

    expect(await createService().decidePraise(USER_ID, evidence)).toEqual({ suppressed: "killswitch" });
  });

  it("claims a praise once per local day and marks the cooldown", async () => {
    const service = createService();

    expect(await service.markPraiseShown(USER_ID, "mature_word")).toBe(true);
    expect(await service.markPraiseShown(USER_ID, "mature_word")).toBe(false);

    expect(repo.events).toHaveLength(1);
    expect(repo.events[0]).toMatchObject({
      kind: "praise",
      weight: 0,
      dedupeKey: `praise:mature_word:${localDayKey("Europe/Berlin", NOW)}`,
    });
    expect(repo.snapshots.get(USER_ID)?.lastPraiseAt).toEqual(NOW);
  });

  it("suppresses on cooldown right after a shown praise", async () => {
    const service = createService();
    await service.markPraiseShown(USER_ID, "mature_word");

    expect(await service.decidePraise(USER_ID, evidence)).toEqual({ suppressed: "cooldown" });
  });

  it("suppresses the third praise of a rolling week", async () => {
    let now = new Date(NOW.getTime() - 5 * DAY_MS);
    const service = createService(() => now);

    await service.markPraiseShown(USER_ID, "mature_word");
    now = new Date(NOW.getTime() - 2 * DAY_MS);
    await service.markPraiseShown(USER_ID, "dictionary_10");
    now = NOW;

    expect(await service.decidePraise(USER_ID, evidence)).toEqual({ suppressed: "weekly_cap" });
  });

  it("lets a praise through once the older one has aged out of the week", async () => {
    let now = new Date(NOW.getTime() - 8 * DAY_MS);
    const service = createService(() => now);

    await service.markPraiseShown(USER_ID, "mature_word");
    now = new Date(NOW.getTime() - 2 * DAY_MS);
    await service.markPraiseShown(USER_ID, "dictionary_10");
    now = NOW;

    const outcome = await service.decidePraise(USER_ID, evidence);

    expect(outcome).toEqual({ decision: { kind: "mature_word", i18nKey: "praiseMatureWord", params: {} } });
  });
});

describe("countActiveDays", () => {
  it("counts distinct local days with real effort inside the window", async () => {
    const service = createService();
    const days = [1, 1, 3, 40];
    for (const [index, ago] of days.entries()) {
      await service.record({
        userId: USER_ID,
        kind: "translate",
        dedupeKey: `translate:${index}`,
        occurredAt: new Date(NOW.getTime() - ago * DAY_MS),
      });
    }

    expect(await service.countActiveDays(USER_ID)).toBe(2);
  });
});

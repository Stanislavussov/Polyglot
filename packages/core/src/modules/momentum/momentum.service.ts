/**
 * Momentum service — the only writer of the journal and the snapshot (§4).
 *
 * No scheduler: decay is computed lazily on read, credit happens at the moment of
 * the fact. A system without a scheduler cannot spam anyone.
 */
import type { MomentumRepository } from "../../ports/momentum.repository.js";
import { applyEffort, cappedWeight, decay, localDayBounds, localDayKey, resolveBand } from "./momentum.math.js";
import {
  EFFORT_WEIGHTS,
  type EffortKind,
  type MomentumBand,
  type MotivationConfig,
  type PraiseKind,
} from "./momentum.types.js";
import { type PraiseEvidence, type PraiseOutcome, selectPraise } from "./praise.selector.js";

/** A pause of a week or more is what "came back" means, and also the floor between two recovery lines (§2.2 S3). */
export const RECOVERY_GAP_MS = 7 * 24 * 60 * 60 * 1000;

const PRAISE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface MomentumServiceDeps {
  momentumRepository: MomentumRepository;
  /** Re-read per call, never latched at container build time, or the kill switch would need a restart (§4.1). */
  getMotivationConfig(): Promise<MotivationConfig>;
  getTimezone(userId: number): Promise<string>;
  now?: () => Date;
}

export interface RecordEffortInput {
  userId: number;
  kind: EffortKind;
  dedupeKey: string;
  occurredAt?: Date;
}

export interface RecordEffortResult {
  inserted: boolean;
  weight: number;
}

export interface MomentumView {
  /** Discounted to `at` — the raw stored score is not comparable across users (§3.1). */
  score: number;
  at: Date;
  band: MomentumBand;
  lastSeenAt: Date | null;
  lastPraiseAt: Date | null;
  lastRecoveryAt: Date | null;
}

export type RecoveryDecision = { show: true; gapDays: number } | { show: false };

export function createMomentumService(deps: MomentumServiceDeps) {
  const clock = deps.now ?? (() => new Date());
  const repo = deps.momentumRepository;

  async function loadView(userId: number, at: Date): Promise<MomentumView> {
    const snapshot = await repo.getSnapshot(userId);
    const score = snapshot ? decay(snapshot.score, snapshot.scoredAt, at) : 0;
    return {
      score,
      at,
      band: resolveBand(score),
      lastSeenAt: snapshot?.lastSeenAt ?? null,
      lastPraiseAt: snapshot?.lastPraiseAt ?? null,
      lastRecoveryAt: snapshot?.lastRecoveryAt ?? null,
    };
  }

  async function decideRecovery(userId: number, now = clock()): Promise<RecoveryDecision> {
    const config = await deps.getMotivationConfig();
    if (!config.recoveryEnabled) return { show: false };
    const snapshot = await repo.getSnapshot(userId);
    // A user we have never seen has nothing to come back from; markSeen initializes them instead.
    if (!snapshot?.lastSeenAt) return { show: false };
    const gapMs = now.getTime() - snapshot.lastSeenAt.getTime();
    if (gapMs < RECOVERY_GAP_MS) return { show: false };
    if (snapshot.lastRecoveryAt && now.getTime() - snapshot.lastRecoveryAt.getTime() < RECOVERY_GAP_MS) {
      return { show: false };
    }
    return { show: true, gapDays: Math.floor(gapMs / (24 * 60 * 60 * 1000)) };
  }

  return {
    /**
     * Credit one effort. The journal row is written even at weight 0 so the dedupe key
     * keeps working; the snapshot moves only when the row actually landed (§3.4, §3.8).
     */
    async record(effort: RecordEffortInput): Promise<RecordEffortResult> {
      const config = await deps.getMotivationConfig();
      if (!config.recordingEnabled) return { inserted: false, weight: 0 };

      const occurredAt = effort.occurredAt ?? clock();
      let weight = EFFORT_WEIGHTS[effort.kind];
      if (effort.kind !== "mature") {
        const timezone = await deps.getTimezone(effort.userId);
        const { start, end } = localDayBounds(timezone, occurredAt);
        const usedToday = await repo.sumWeightsForLocalDay(effort.userId, effort.kind, start, end);
        weight = cappedWeight(effort.kind, usedToday);
      }

      const inserted = await repo.recordEvent({
        userId: effort.userId,
        kind: effort.kind,
        weight,
        occurredAt,
        dedupeKey: effort.dedupeKey,
      });
      if (!inserted) return { inserted: false, weight };

      const snapshot = await repo.getSnapshot(effort.userId);
      const state = snapshot
        ? { score: snapshot.score, scoredAt: snapshot.scoredAt }
        : { score: 0, scoredAt: occurredAt };
      const next = applyEffort(state, weight, occurredAt);
      await repo.applySnapshot(effort.userId, { score: next.score, scoredAt: next.scoredAt, updatedAt: clock() });
      return { inserted: true, weight };
    },

    getSnapshot(userId: number, now = clock()): Promise<MomentumView> {
      return loadView(userId, now);
    },

    decideRecovery,

    /** The recovery line has been delivered: both the pause and the cooldown restart here. */
    async markRecoveryShown(userId: number, now = clock()): Promise<void> {
      await repo.applySnapshot(userId, { lastSeenAt: now, lastRecoveryAt: now, updatedAt: now });
    },

    async markSeen(userId: number, now = clock()): Promise<void> {
      await repo.applySnapshot(userId, { lastSeenAt: now, updatedAt: now });
    },

    /**
     * Deferred delivery (§2.2 S3): while a recovery line is decided but unshown,
     * `lastSeenAt` must stay stale, or an intermediate screen with nowhere to put the
     * line would burn the user's single chance to receive it.
     */
    async touchSeen(userId: number, now = clock()): Promise<void> {
      const pending = await decideRecovery(userId, now);
      if (pending.show) return;
      await repo.applySnapshot(userId, { lastSeenAt: now, updatedAt: now });
    },

    async decidePraise(userId: number, evidence: PraiseEvidence, now = clock()): Promise<PraiseOutcome> {
      const config = await deps.getMotivationConfig();
      if (!config.praiseEnabled) return { suppressed: "killswitch" };
      const snapshot = await repo.getSnapshot(userId);
      const praiseCountLast7d = await repo.countEventsSince(
        userId,
        "praise",
        new Date(now.getTime() - PRAISE_WINDOW_MS),
      );
      return selectPraise({ evidence, lastPraiseAt: snapshot?.lastPraiseAt ?? null, praiseCountLast7d, now });
    },

    /** Returns whether this praise was newly claimed — a replayed update loses the race and stays silent. */
    async markPraiseShown(userId: number, kind: PraiseKind, now = clock()): Promise<boolean> {
      const timezone = await deps.getTimezone(userId);
      const inserted = await repo.recordEvent({
        userId,
        kind: "praise",
        weight: 0,
        occurredAt: now,
        dedupeKey: `praise:${kind}:${localDayKey(timezone, now)}`,
      });
      if (!inserted) return false;
      await repo.applySnapshot(userId, { lastPraiseAt: now, updatedAt: now });
      return true;
    },

    async countActiveDays(userId: number, days = 28, now = clock()): Promise<number> {
      const timezone = await deps.getTimezone(userId);
      const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      return repo.countActiveDays(userId, since, timezone);
    },
  };
}

export type MomentumService = ReturnType<typeof createMomentumService>;

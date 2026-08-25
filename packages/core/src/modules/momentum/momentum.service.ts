/**
 * The only writer of the journal and the snapshot (§4). No scheduler: decay is
 * computed lazily on read and credit happens at the moment of the fact, because a
 * system without a scheduler cannot spam anyone.
 */
import { logEvent } from "../../observability/events.js";
import type { MomentumRepository } from "../../ports/momentum.repository.js";
import { applyEffort, cappedWeight, decay, localDayBounds, localDayKey, resolveBand } from "./momentum.math.js";
import {
  EFFORT_WEIGHTS,
  type EffortKind,
  type MomentumBand,
  type MomentumSnapshot,
  type MotivationConfig,
  type PraiseKind,
} from "./momentum.types.js";
import { isOnceEverPraise, type PraiseEvidence, type PraiseOutcome, selectPraise } from "./praise.selector.js";

/** A pause of a week or more is what "came back" means, and also the floor between two recovery lines (§2.2 S3). */
export const RECOVERY_GAP_MS = 7 * 24 * 60 * 60 * 1000;

const PRAISE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Below this age a stored `lastSeenAt` already answers everything it is asked. */
const SEEN_FRESH_MS = 60 * 60 * 1000;

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
  /**
   * The deterministic key (§3.8), or — for a key bucketed by the user's local day
   * such as `review:<entryId>:<YYYY-MM-DD>` — a factory receiving that day. The
   * factory form exists so the caller does not repeat the timezone lookup the daily
   * cap already performs.
   */
  dedupeKey: string | ((localDay: string) => string);
  occurredAt?: Date;
  /**
   * The user's timezone, when the caller already holds it. Preferred over
   * `getTimezone`, whose implementation is a `user_language_settings` SELECT the
   * caller's own per-update memo has usually just paid for.
   */
  timezone?: string;
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

/**
 * The recovery decision as a pure function of the snapshot.
 *
 * Split out because every writer of `lastSeenAt` has to ask it before moving the
 * mark — deferred delivery (§2.2 S3) — and each of them already holds the snapshot.
 */
function decideRecoveryFrom(snapshot: MomentumSnapshot | null, config: MotivationConfig, now: Date): RecoveryDecision {
  if (!config.recoveryEnabled) return { show: false };
  // A user we have never seen has nothing to come back from; the first touch initializes them.
  if (!snapshot?.lastSeenAt) return { show: false };
  const gapMs = now.getTime() - snapshot.lastSeenAt.getTime();
  if (gapMs < RECOVERY_GAP_MS) return { show: false };
  if (snapshot.lastRecoveryAt && now.getTime() - snapshot.lastRecoveryAt.getTime() < RECOVERY_GAP_MS) {
    return { show: false };
  }
  return { show: true, gapDays: Math.floor(gapMs / (24 * 60 * 60 * 1000)) };
}

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

  /**
   * `recordingEnabled` gates every write, journal row and snapshot alike (§4.6).
   * The seen/praise/recovery marks are snapshot-only, so without this check a bot
   * with recording off would still create `user_momentum` rows — a kill switch that
   * does not fully stop writing is not a kill switch.
   */
  async function recordingAllowed(): Promise<boolean> {
    return (await deps.getMotivationConfig()).recordingEnabled;
  }

  async function decideRecovery(userId: number, now = clock()): Promise<RecoveryDecision> {
    const config = await deps.getMotivationConfig();
    if (!config.recoveryEnabled) return { show: false };
    return decideRecoveryFrom(await repo.getSnapshot(userId), config, now);
  }

  /**
   * A once-ever praise is claimed by its kind alone, exactly like `mature:<translationId>`.
   * With a local day in the key, a user parked at ten words would earn `dictionary_10`
   * again every time the previous row aged out of the rolling week — forever.
   */
  async function praiseDedupeKey(userId: number, kind: PraiseKind, now: Date): Promise<string> {
    if (isOnceEverPraise(kind)) return `praise:${kind}`;
    return `praise:${kind}:${localDayKey(await deps.getTimezone(userId), now)}`;
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
      let timezone: string | null = null;
      const resolveTimezone = async (): Promise<string> =>
        (timezone ??= effort.timezone ?? (await deps.getTimezone(effort.userId)));

      let weight = EFFORT_WEIGHTS[effort.kind];
      if (effort.kind !== "mature") {
        const { start, end } = localDayBounds(await resolveTimezone(), occurredAt);
        const usedToday = await repo.sumWeightsForLocalDay(effort.userId, effort.kind, start, end);
        weight = cappedWeight(effort.kind, usedToday);
      }

      const inserted = await repo.recordEvent({
        userId: effort.userId,
        kind: effort.kind,
        weight,
        occurredAt,
        dedupeKey:
          typeof effort.dedupeKey === "string"
            ? effort.dedupeKey
            : effort.dedupeKey(localDayKey(await resolveTimezone(), occurredAt)),
      });
      if (!inserted) return { inserted: false, weight };

      const snapshot = await repo.getSnapshot(effort.userId);
      const state = snapshot
        ? { score: snapshot.score, scoredAt: snapshot.scoredAt }
        : { score: 0, scoredAt: occurredAt };
      const next = applyEffort(state, weight, occurredAt);
      // A review, a save, a mentor turn and a matured word are all "the user was here":
      // without this only translations would advance the mark, and someone who reviews
      // daily for a week would be welcomed back on their next translation (§4.3). The
      // pending-recovery guard is `touchSeen`'s — none of these paths renders the
      // recovery line, so advancing past an undecided one would lose it (§2.2 S3).
      const marksSeen =
        effort.kind !== "translate" && !decideRecoveryFrom(snapshot, config, occurredAt).show
          ? { lastSeenAt: occurredAt }
          : {};
      await repo.applySnapshot(effort.userId, {
        score: next.score,
        scoredAt: next.scoredAt,
        updatedAt: clock(),
        ...marksSeen,
      });

      const bandBefore = resolveBand(decay(state.score, state.scoredAt, next.scoredAt));
      const bandAfter = resolveBand(next.score);
      if (bandBefore !== bandAfter) {
        logEvent("momentum.band_changed", { userId: effort.userId, from: bandBefore, to: bandAfter });
      }
      return { inserted: true, weight };
    },

    getSnapshot(userId: number, now = clock()): Promise<MomentumView> {
      return loadView(userId, now);
    },

    decideRecovery,

    /** The recovery line has been delivered: both the pause and the cooldown restart here. */
    async markRecoveryShown(userId: number, now = clock()): Promise<void> {
      if (!(await recordingAllowed())) return;
      await repo.applySnapshot(userId, { lastSeenAt: now, lastRecoveryAt: now, updatedAt: now });
    },

    /**
     * Deferred delivery (§2.2 S3): while a recovery line is decided but unshown,
     * `lastSeenAt` must stay stale, or an intermediate screen with nowhere to put the
     * line would burn the user's single chance to receive it.
     */
    async touchSeen(userId: number, now = clock()): Promise<void> {
      const config = await deps.getMotivationConfig();
      if (!config.recordingEnabled) return;
      const snapshot = await repo.getSnapshot(userId);
      if (decideRecoveryFrom(snapshot, config, now).show) return;
      // An hour-old mark already answers the only question `lastSeenAt` is asked — is
      // the gap seven days? — so rewriting it on every update is an UPSERT no reader
      // can tell from the one before it.
      if (snapshot?.lastSeenAt && now.getTime() - snapshot.lastSeenAt.getTime() < SEEN_FRESH_MS) return;
      await repo.applySnapshot(userId, { lastSeenAt: now, updatedAt: now });
    },

    async decidePraise(userId: number, evidence: PraiseEvidence, now = clock()): Promise<PraiseOutcome> {
      const config = await deps.getMotivationConfig();
      if (!config.praiseEnabled) return { suppressed: "killswitch" };
      const [snapshot, praiseCountLast7d, praisedKinds] = await Promise.all([
        repo.getSnapshot(userId),
        repo.countEventsSince(userId, "praise", new Date(now.getTime() - PRAISE_WINDOW_MS)),
        repo.listPraisedKinds(userId),
      ]);
      return selectPraise({
        evidence,
        lastPraiseAt: snapshot?.lastPraiseAt ?? null,
        praiseCountLast7d,
        praisedKinds: new Set(praisedKinds),
        now,
      });
    },

    /** Returns whether this praise was newly claimed — a replayed update loses the race and stays silent. */
    async markPraiseShown(userId: number, kind: PraiseKind, now = clock()): Promise<boolean> {
      if (!(await recordingAllowed())) return false;
      const inserted = await repo.recordEvent({
        userId,
        kind: "praise",
        weight: 0,
        occurredAt: now,
        dedupeKey: await praiseDedupeKey(userId, kind, now),
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

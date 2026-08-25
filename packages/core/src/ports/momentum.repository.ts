/**
 * Momentum persistence port (§5.4): an append-only journal plus a one-row-per-user
 * snapshot. Deliberately absent from `ports/index.ts` — CLAUDE.md rule 4 forbids
 * expanding an existing barrel, so consumers import this file by path.
 *
 * Every instant is supplied by the caller's injected clock; the adapter must not
 * substitute the database's `now()` (§4.4).
 */
import type { EffortKind, MomentumEventKind, MomentumSnapshot } from "../modules/momentum/momentum.types.js";

export interface RecordMomentumEventInput {
  userId: number;
  kind: MomentumEventKind;
  weight: number;
  occurredAt: Date;
  dedupeKey: string;
}

export interface MomentumReplayEvent {
  kind: MomentumEventKind;
  weight: number;
  occurredAt: Date;
}

export interface MomentumRepository {
  getSnapshot(userId: number): Promise<MomentumSnapshot | null>;
  /** `false` means the unique `(userId, dedupeKey)` index rejected the row — a replay, not an error. */
  recordEvent(event: RecordMomentumEventInput): Promise<boolean>;
  applySnapshot(userId: number, patch: Partial<MomentumSnapshot> & { updatedAt: Date }): Promise<void>;
  /** Points already spent by `kind` inside the user's local day, as `[dayStart, dayEnd)` UTC instants. */
  sumWeightsForLocalDay(userId: number, kind: EffortKind, dayStart: Date, dayEnd: Date): Promise<number>;
  countEventsSince(userId: number, kind: MomentumEventKind, since: Date): Promise<number>;
  countActiveDays(userId: number, since: Date, timezone: string): Promise<number>;
  listEventsForReplay(userId: number): Promise<MomentumReplayEvent[]>;
}

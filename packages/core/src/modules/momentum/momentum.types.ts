/**
 * Momentum — the vocabulary of the motivation layer (Task 81).
 *
 * The stored `score` is only comparable after discounting it to a common
 * instant (§3.1): two users with the same number but different `scoredAt` are
 * in different shape. Nothing here renders text — the praise selector returns
 * i18n keys, and the bot owns the copy.
 */
import { z } from "zod";
import type { I18nKey } from "../i18n/types.js";

/** Kinds that carry effort weight. `praise` is a journal token, not an effort — see {@link MomentumEventKind}. */
export const EFFORT_KINDS = ["translate", "save", "review", "mentor_turn", "mature"] as const;

export type EffortKind = (typeof EFFORT_KINDS)[number];

/**
 * What the journal's `kind` column holds: every effort, plus two weightless tokens (§3.8).
 *
 * `weekly_proof` is separate from `praise` rather than another `praise:` key because
 * `decidePraise` counts `praise` rows to enforce the two-per-week praise cap — filing
 * the notification's weekly line there would silently spend one of the card's two
 * praise slots every week for every subscriber.
 */
export type MomentumEventKind = EffortKind | "praise" | "weekly_proof";

export const EFFORT_WEIGHTS: Record<EffortKind, number> = {
  translate: 1,
  save: 2,
  review: 3,
  mentor_turn: 3,
  mature: 10,
};

/**
 * Points (not event count) a single kind may contribute per local day (§3.4).
 * Each cap is a multiple of its event weight so no half-credit event exists.
 * `mature` is absent because it is uncapped by design.
 */
export const DAILY_CAPS: Record<Exclude<EffortKind, "mature">, number> = {
  translate: 3,
  save: 4,
  review: 6,
  mentor_turn: 6,
};

/** Decay half-life: a week away halves the score (§3.2). */
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `srsInterval` at which a word counts as "stuck" (§3.10). Pinned to the SM-2
 * ladder in `modules/srs/sm2.ts`: four consecutive "good" gives 1, 6, 15, 38, so
 * the threshold is crossed on the fourth review — 22 calendar days after the first.
 */
export const MATURE_INTERVAL_DAYS = 21;

export type MomentumBand = "resting" | "warming" | "steady" | "strong";

/** Placeholders. Replaced by p40/p70/p90 of the discounted score (query V3) after 28 days of recording — plan §3.6. */
export const BAND_THRESHOLDS: Record<Exclude<MomentumBand, "resting">, number> = {
  warming: 15,
  steady: 33,
  strong: 66,
};

export interface MomentumState {
  score: number;
  /** The instant `score` is already discounted to. */
  scoredAt: Date;
}

export interface MomentumSnapshot extends MomentumState {
  /**
   * Own moment, deliberately not `user_language_settings.lastInteractionAt` (§4.3):
   * it advances when the recovery line is *shown*, not on every update.
   */
  lastSeenAt: Date | null;
  lastPraiseAt: Date | null;
  lastRecoveryAt: Date | null;
}

export interface EffortEvent {
  userId: number;
  kind: EffortKind;
  /** Deterministic by construction — never a counted ordinal, or retries would double-credit (§3.8). */
  dedupeKey: string;
  occurredAt: Date;
  timezone: string;
}

export type PraiseKind =
  | "mature_word"
  | "first_mature"
  | "dictionary_10"
  | "dictionary_25"
  | "dictionary_50"
  | "dictionary_100"
  | "hard_word_recalled";

/**
 * An i18n key plus params — never a rendered string; core does not own copy.
 *
 * `I18nKey` rather than `string`: the selector is the only place that decides which
 * copy a praise carries, so a key that no locale defines must fail the build here
 * and not degrade into a raw key printed at the user (`t` falls back to the key).
 */
export interface PraiseDecision {
  kind: PraiseKind;
  i18nKey: I18nKey;
  params: Record<string, string | number>;
}

/**
 * The `motivation` blob in `system_settings`. `recordingEnabled` gates writing to
 * the journal; the other three gate rendering (§4.6).
 */
export interface MotivationConfig {
  recordingEnabled: boolean;
  enabled: boolean;
  praiseEnabled: boolean;
  recoveryEnabled: boolean;
}

/** Fail-open on recording (invisible and irrecoverable if lost), fail-closed on every visible surface (§4.6). */
export const DEFAULT_MOTIVATION_CONFIG: MotivationConfig = {
  recordingEnabled: true,
  enabled: false,
  praiseEnabled: false,
  recoveryEnabled: false,
};

/**
 * Per-key `.catch()` rather than a whole-object fallback: a blob where one switch
 * is garbage must not discard the operator's valid choices for the other three.
 * `getWithFallback` is unusable here — its shallow merge heals missing keys but
 * lets a present-but-invalid value survive, which for a kill switch is the one
 * failure that matters.
 */
const motivationConfigSchema = z.object({
  recordingEnabled: z.boolean().catch(DEFAULT_MOTIVATION_CONFIG.recordingEnabled),
  enabled: z.boolean().catch(DEFAULT_MOTIVATION_CONFIG.enabled),
  praiseEnabled: z.boolean().catch(DEFAULT_MOTIVATION_CONFIG.praiseEnabled),
  recoveryEnabled: z.boolean().catch(DEFAULT_MOTIVATION_CONFIG.recoveryEnabled),
});

/**
 * Validates the untrusted `motivation` blob at the DB read boundary — the JSONB
 * column is an unchecked cast, so a hand-edited or legacy row is typed but not safe.
 *
 * Not logged on the failure path on purpose: `recordingEnabled` is re-read on every
 * `record()` call (§4.1), so a broken blob would spam Loki once per user action.
 */
export function parseMotivationConfig(raw: unknown): MotivationConfig {
  const parsed = motivationConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_MOTIVATION_CONFIG };
}

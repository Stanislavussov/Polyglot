import type { TranslateOutput } from "../modules/translation/types.js";

/**
 * A pre-rendered onboarding hook card (Task 72).
 *
 * Cards are generated ahead of time per `(learning language, native language,
 * headword)` so the onboarding payoff screen can render a real translation
 * instantly instead of making a new user wait out the pipeline's p95.
 */
export interface OnboardingDemoCard {
  id: number;
  /** Learning language the headword belongs to (ISO 639-1). */
  sourceLang: string;
  /** Native language the card was rendered for (ISO 639-1). */
  nativeLang: string;
  headword: string;
  payload: TranslateOutput;
  /** Ordering within the hook keyboard. */
  sortOrder: number;
  /** Reviewed and safe to show. Unreviewed cards are never served. */
  isActive: boolean;
  createdAt: Date;
}

export interface UpsertOnboardingDemoCardInput {
  sourceLang: string;
  nativeLang: string;
  headword: string;
  payload: TranslateOutput;
  sortOrder?: number;
}

export interface OnboardingDemoCardRepository {
  /** Reviewed cards for a language pair, in keyboard order. */
  findActive(sourceLang: string, nativeLang: string): Promise<OnboardingDemoCard[]>;
  /** A single reviewed card by its natural key; null when missing or unreviewed. */
  findOne(sourceLang: string, nativeLang: string, headword: string): Promise<OnboardingDemoCard | null>;
  /** Whether the triple already has a payload, reviewed or not (warm-up skip check). */
  hasCached(sourceLang: string, nativeLang: string, headword: string): Promise<boolean>;
  /** The review step: publish or un-publish a cached card. False when nothing is cached. */
  setActive(sourceLang: string, nativeLang: string, headword: string, isActive: boolean): Promise<boolean>;
  /** Cache a rendered card. Never flips `isActive` — publishing stays a review step. */
  upsert(input: UpsertOnboardingDemoCardInput): Promise<void>;
}

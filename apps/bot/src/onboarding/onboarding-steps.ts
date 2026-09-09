/**
 * Onboarding step/outcome vocabulary and the metrics helper that records it
 * (Task 72, slice 1 — "instrumentation ships first, so before/after is
 * measurable").
 *
 * The step numbers are the values persisted in `users.onboarding_step`, so they
 * are a storage contract, not a display detail: never renumber an existing step,
 * only append.
 */
import { onboardingStepCounter } from "../metrics.js";

/**
 * The four screens of the Task 72 flow, in the order the user meets them.
 *
 * `complete` (4) is what `markOnboarded` writes; rows that finished under
 * the pre-Task-72 three-screen flow carry `3` instead, so a funnel over historic
 * data must read `onboarded` — not the step alone — to tell "finished" from
 * "abandoned on the demo screen".
 */
export const ONBOARDING_STEPS = {
  native: 1,
  languages: 2,
  demo: 3,
  complete: 4,
} as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[keyof typeof ONBOARDING_STEPS];

/**
 * What happened on a screen. Like `TRANSLATION_PHASES`, this is enumerated
 * here rather than passed as a free-form string at the call site — that is what
 * keeps `bot_onboarding_step_total` bounded at `steps × outcomes` series. Never
 * add a user, language, word or model dimension to this metric.
 *
 * - `entered` — the screen was rendered (the funnel denominator).
 * - `hook_tapped` — the demo card was served from a curated hook button.
 * - `typed_word` — the demo ran the live pipeline on user-typed input.
 * - `failed` — the screen's action errored (e.g. the demo pipeline threw).
 * - `completed` — the user moved past the screen.
 *
 * Abandonment is deliberately not an outcome: nothing observes it at the moment
 * it happens. It is derived in the funnel query as `entered` without a matching
 * `completed`, and in the DB as the furthest `onboarding_step` of a user who is
 * still `onboarded = false`.
 */
export const ONBOARDING_OUTCOMES = ["entered", "hook_tapped", "typed_word", "failed", "completed"] as const;

export type OnboardingOutcome = (typeof ONBOARDING_OUTCOMES)[number];

/**
 * Records one onboarding step/outcome event on the Prometheus counter.
 *
 * Pure metrics helper by design: the durable half of the instrumentation
 * (`updateOnboardingStep` / `markOnboarded`) stays at the call site, so this can
 * never take a DB dependency or fail a user-facing handler.
 */
export function recordOnboardingStep(step: OnboardingStep, outcome: OnboardingOutcome): void {
  onboardingStepCounter.inc({ step: String(step), outcome });
}

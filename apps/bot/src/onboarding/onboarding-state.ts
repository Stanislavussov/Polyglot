/**
 * Onboarding state — derived, never held (Task 72, slice 7).
 *
 * The redesigned flow keeps **no** in-memory state. Every screen is re-derived
 * from the database on each update: `users.onboarding_step` says which screen the
 * user is on, `user_language_settings` holds the native/learning choices, and
 * `user_learning_languages` holds the CEFR level per learning language.
 *
 * That is what kills the failure class the old grammY conversation had: there is
 * no dialog to time out, so a pause of any length leaves every button live, and
 * an update the flow does not recognise simply falls through to the normal
 * middleware chain instead of being swallowed.
 */
import { isSupported, type SupportedLang } from "@polyglot/core";
import type { BotContext } from "../types.js";
import { ONBOARDING_STEPS, type OnboardingStep } from "./onboarding-steps.js";

/** CEFR levels offered on the inline level row, in display order. */
export const PROFICIENCY_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

/**
 * What "🤷 I don't know" persists. Deliberately the same value as the
 * `user_learning_languages.proficiency_level` column default, so a shrugged
 * answer is indistinguishable downstream from an explicit B1 — most people do
 * not know their CEFR level, and a dead end there is worse than a slightly
 * wrong level.
 */
export const DEFAULT_PROFICIENCY_LEVEL: ProficiencyLevel = "B1";

export function isProficiencyLevel(value: string): value is ProficiencyLevel {
  return (PROFICIENCY_LEVELS as readonly string[]).includes(value);
}

export interface OnboardingState {
  userId: number;
  /**
   * Raw `users.onboarding_step` value — the furthest screen ever reached. Kept
   * separate from {@link OnboardingState.step} so the funnel can only ever move
   * forward: re-rendering an earlier screen must not rewind it.
   */
  persistedStep: number;
  /** The screen to render now, clamped to what the stored data can support. */
  step: OnboardingStep;
  /** Confirmed native language, or null while screen 0 is unanswered. */
  nativeLang: string | null;
  /** Interface language to render in — inferred, never asked. */
  interfaceLang: SupportedLang;
  /** Learning languages that already have a level (the only ones ever persisted). */
  learningLangs: string[];
  /** language code → CEFR level. */
  levels: Record<string, string>;
}

/**
 * Infer the interface language from the native language, falling back to the
 * Telegram locale and finally to English. The user is never asked for it.
 */
export function inferInterfaceLang(nativeLang: string | null, telegramLocale?: string): SupportedLang {
  if (nativeLang && isSupported(nativeLang)) return nativeLang;
  if (telegramLocale) {
    const code = telegramLocale.split("-")[0].toLowerCase();
    if (isSupported(code)) return code as SupportedLang;
  }
  return "en";
}

/**
 * Guess the native language from the Telegram client locale (`ctx.from.language_code`),
 * e.g. `"ru"` or `"en-US"`. Returns null when the locale is missing or is not one
 * of the languages the picker offers — the caller then goes straight to the full
 * picker rather than showing a confirm button for a language we cannot store.
 */
export function guessNativeLangFromLocale(ctx: BotContext): string | null {
  const locale = ctx.from?.language_code;
  if (!locale) return null;
  const code = locale.split("-")[0].toLowerCase();
  const offered = ctx.services.languageCache.getSupportedLangs();
  return offered.some((entry) => entry.code === code) ? code : null;
}

/**
 * Read the whole onboarding state for the current user in one go.
 * Returns null when the context carries no user (nothing sensible to render).
 */
export async function loadOnboardingState(ctx: BotContext): Promise<OnboardingState | null> {
  const user = ctx.user;
  if (!user) return null;

  const [settings, levelRows] = await Promise.all([
    ctx.services.userRepository.getSettings(user.id),
    ctx.services.userRepository.getLanguageLevels(user.id),
  ]);

  const storedLevels: Record<string, string> = {};
  for (const row of levelRows) {
    storedLevels[row.languageCode] = row.proficiencyLevel;
  }

  const nativeLang = settings?.nativeLang ?? null;
  // A language is only ever written to `learningLangs` once its level has been
  // chosen, so the two sources cannot disagree — but intersect them in both
  // directions anyway. `user_learning_languages` has no delete path, so a row
  // left behind by a deselected language would otherwise keep rendering that
  // language as confirmed.
  const learningLangs = (settings?.learningLangs ?? []).filter((code) => code in storedLevels);
  const levels: Record<string, string> = {};
  for (const code of learningLangs) {
    levels[code] = storedLevels[code];
  }

  return {
    userId: user.id,
    persistedStep: user.onboardingStep,
    step: resolveStep(user.onboardingStep, nativeLang, learningLangs),
    nativeLang,
    interfaceLang: inferInterfaceLang(nativeLang, ctx.from?.language_code),
    learningLangs,
    levels,
  };
}

/**
 * Clamp the persisted step to what the stored data can actually support, so a
 * half-written run (e.g. the process died between the settings write and the
 * step write) resumes on a screen the user can complete rather than on one whose
 * prerequisites are missing.
 */
function resolveStep(persistedStep: number, nativeLang: string | null, learningLangs: string[]): OnboardingStep {
  if (!nativeLang) return ONBOARDING_STEPS.native;
  if (learningLangs.length === 0) return ONBOARDING_STEPS.languages;
  return persistedStep >= ONBOARDING_STEPS.demo ? ONBOARDING_STEPS.demo : ONBOARDING_STEPS.languages;
}

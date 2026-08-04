/**
 * Onboarding keyboards (Task 72, slices 2/3/5/6).
 *
 * Every language keyboard is **two columns** — the old flow put one button per
 * row, which turned ten languages into a scroll. The CEFR level row is a single
 * row of six compact `A1`…`C2` buttons; the long "A1 — Beginner" wording that
 * forced one-per-row lives in the prompt text above it now.
 *
 * All callback data shares the `onb:` prefix so the whole flow registers as one
 * handler group and nothing can collide with the translate/settings namespaces.
 */
import { type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { getHookWordsForLangs } from "./hook-cards.js";
import type { OnboardingState } from "./onboarding-state.js";
import { PROFICIENCY_LEVELS } from "./onboarding-state.js";

/** Callback-data prefixes emitted by the onboarding screens. */
export const ONB = {
  native: "onb:nat:",
  language: "onb:lang:",
  level: "onb:lvl:",
  collapse: "onb:collapse",
  /** Back to screen 0 — the native language is a one-tap guess and must be undoable. */
  backToNative: "onb:back:native",
  done: "onb:done",
  hook: "onb:hook:",
  feature: "onb:go:",
} as const;

/** Sentinel level values that are not CEFR codes. */
export const LEVEL_UNKNOWN = "unknown";
export const LEVEL_REMOVE = "remove";

/** Feature entry points offered on the final screen, in display order. */
export const ONBOARDING_FEATURES = ["dictionary", "training", "video", "settings"] as const;

export type OnboardingFeature = (typeof ONBOARDING_FEATURES)[number];

export function isOnboardingFeature(value: string): value is OnboardingFeature {
  return (ONBOARDING_FEATURES as readonly string[]).includes(value);
}

interface Button {
  label: string;
  data: string;
}

/** Lay buttons out two per row, closing a trailing odd row. */
function twoColumns(keyboard: InlineKeyboard, buttons: readonly Button[]): void {
  buttons.forEach((button, index) => {
    keyboard.text(button.label, button.data);
    if (index % 2 === 1) keyboard.row();
  });
  if (buttons.length % 2 === 1) keyboard.row();
}

/**
 * Screen 0. Every supported language is on screen at once — there is no
 * "another language" step to find.
 *
 * The language guessed from the Telegram locale is promoted to its own full-width
 * row and says outright what picking it means ("I'm a native speaker"), because
 * the guess is only ever a hint: it reports the *interface* language of the
 * Telegram app, which for an expat or anyone with an English phone is not their
 * mother tongue. Everyone else is one tap away in the list below, under their own
 * autonym, which reads regardless of the reader's script.
 */
export function buildNativeKeyboard(ctx: BotContext, lang: SupportedLang, guessed: string | null): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const { languageCache } = ctx.services;

  if (guessed) {
    keyboard
      .text(t("onbNativeConfirmYes", lang, { lang: languageCache.getLangDisplay(guessed) }), `${ONB.native}${guessed}`)
      .row();
  }

  twoColumns(
    keyboard,
    languageCache
      .getSupportedLangs()
      .filter((entry) => entry.code !== guessed)
      .map((entry) => ({
        label: languageCache.getLangDisplay(entry.code),
        data: `${ONB.native}${entry.code}`,
      })),
  );

  return keyboard;
}

/**
 * Screen 1. When `expandedLang` is set the CEFR row for that language is shown
 * first (one row of six, plus "I don't know", plus remove/back), followed by the
 * remaining languages. Otherwise the plain two-column language list is shown,
 * with confirmed languages rendered as `✅ <lang> · <level>` chips that re-open
 * their level row when tapped.
 */
export function buildLearningKeyboard(
  ctx: BotContext,
  state: OnboardingState,
  expandedLang: string | null,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const { languageCache } = ctx.services;

  if (expandedLang) {
    for (const level of PROFICIENCY_LEVELS) {
      keyboard.text(level, `${ONB.level}${expandedLang}:${level}`);
    }
    keyboard.row();
    keyboard.text(t("onbLevelUnknown", state.interfaceLang), `${ONB.level}${expandedLang}:${LEVEL_UNKNOWN}`);
    keyboard.row();
    if (expandedLang in state.levels) {
      keyboard.text(t("onbLevelRemove", state.interfaceLang), `${ONB.level}${expandedLang}:${LEVEL_REMOVE}`);
      keyboard.row();
    }
    keyboard.text(t("onbLevelCancel", state.interfaceLang), ONB.collapse).row();
  }

  const offered = languageCache
    .getSupportedLangs()
    .filter((entry) => entry.code !== state.nativeLang && entry.code !== expandedLang);

  twoColumns(
    keyboard,
    offered.map((entry) => {
      const level = state.levels[entry.code];
      const display = languageCache.getLangDisplay(entry.code);
      return {
        label: level ? `✅ ${display} · ${level}` : display,
        data: `${ONB.language}${entry.code}`,
      };
    }),
  );

  // "Done" only exists once at least one language carries a level, so a language
  // can never be saved without one and there is no reconciliation step later.
  if (state.learningLangs.length > 0) {
    keyboard.text(t("done", state.interfaceLang), ONB.done).row();
  }

  // Screen 0 confirms a *guessed* native language in a single tap, and that guess
  // decides the interface language for everything after it. Someone on an en-US
  // phone who actually speaks Russian must be able to take it back — without this
  // they would have to finish onboarding in a language they may not read.
  if (!expandedLang) {
    keyboard.text(`⬅️ ${t("back", state.interfaceLang)}`, ONB.backToNative).row();
  }

  return keyboard;
}

/**
 * Screen 2. One button per curated hook word across the user's learning
 * languages — one per row, because headwords are long.
 */
export function buildDemoKeyboard(ctx: BotContext, state: OnboardingState): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const { sourceLang, index, headword } of getHookWordsForLangs(state.learningLangs)) {
    const flag = ctx.services.languageCache.getLangFlag(sourceLang);
    keyboard.text(flag ? `${flag} ${headword}` : headword, `${ONB.hook}${sourceLang}:${index}`).row();
  }
  return keyboard;
}

/** Screen 3. Feature entry points, two columns, routing to the existing scenes. */
export function buildFinalKeyboard(lang: SupportedLang): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  twoColumns(keyboard, [
    { label: t("onbFeatureDictionary", lang), data: `${ONB.feature}dictionary` },
    { label: t("onbFeatureTraining", lang), data: `${ONB.feature}training` },
    { label: t("onbFeatureVideo", lang), data: `${ONB.feature}video` },
    { label: t("onbFeatureSettings", lang), data: `${ONB.feature}settings` },
  ]);
  return keyboard;
}

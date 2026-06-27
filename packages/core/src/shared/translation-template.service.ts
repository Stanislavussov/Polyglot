/**
 * Template Resolution Service — centralized logic for determining
 * which TranslationOutputConfig to use for a given translation request.
 *
 * Pure functions, no side effects, no DB access.
 */

import { SENTENCE_OUTPUT } from "./translation-output.presets.js";
import {
  DEFAULT_TEMPLATE,
  templateToOutputConfig,
  type UserTranslationTemplate,
} from "./translation-template.types.js";
import type { TranslationOutputConfig } from "./types.js";

export type InputContext = "word" | "phrase" | "sentence";

/**
 * Resolve the effective TranslationOutputConfig for a translation request.
 *
 * Rules:
 * 1. Sentences ALWAYS use SENTENCE_OUTPUT (compact, no learning metadata)
 * 2. Words/phrases use the user's custom template if set, otherwise DEFAULT_TEMPLATE
 *
 * @param userTemplate - The user's saved template, or null for default
 * @param inputContext - What kind of input is being translated
 * @param inputLength - Length of the input text in characters (currently unused)
 */
export function resolveOutputConfig(
  userTemplate: UserTranslationTemplate | null,
  inputContext: InputContext,
  _inputLength?: number,
): TranslationOutputConfig {
  // Sentences always use the compact preset — user template doesn't apply
  let config: TranslationOutputConfig;
  if (inputContext === "sentence") {
    config = { ...SENTENCE_OUTPUT };
  } else {
    const template = userTemplate ?? DEFAULT_TEMPLATE;
    config = templateToOutputConfig(template);
  }

  // Grammar breakdown is only inline for phrases — words skip it entirely,
  // sentences use on-demand only (button callback).
  // Note: grammar breakdown analyzes the TARGET translations, not the source,
  // so it is useful even when sourceLang === nativeLang.
  if (inputContext !== "phrase") {
    config.includeGrammarBreakdown = false;
  }

  return config;
}

/**
 * Resolve the effective template (for rendering decisions).
 * Returns the user's custom template or the system default.
 */
export function resolveTemplate(userTemplate: UserTranslationTemplate | null): UserTranslationTemplate {
  return userTemplate ?? DEFAULT_TEMPLATE;
}

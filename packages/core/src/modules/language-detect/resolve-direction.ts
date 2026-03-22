import { detectLanguage } from "./detect-language.js";
import type {
  ResolveDirectionInput,
  ResolveFromSourceInput,
  TranslationDirection,
} from "./types.js";

/**
 * Determine the translation direction based on detected input language.
 *
 * Logic:
 * 1. Detect language of `text` from `[nativeLang, ...learningLangs]`
 * 2. If detected === nativeLang → translate to all learningLangs (standard)
 * 3. If detected is one of learningLangs → translate to nativeLang + remaining learningLangs
 * 4. If undefined (inconclusive) → fallback to nativeLang → learningLangs
 *
 * @param input - Text, native language, and learning languages
 * @returns Resolved source/target languages and detected language info
 *
 * Pure function — no side effects.
 */
export function resolveTranslationDirection(
  input: ResolveDirectionInput,
): TranslationDirection {
  const { text, nativeLang, learningLangs } = input;

  const candidates = [nativeLang, ...learningLangs];
  const detectedLang = detectLanguage(text, candidates);

  // Case 1: Detected native language → standard direction
  // Case 4: Undefined → fallback to standard direction
  if (detectedLang === undefined || detectedLang === nativeLang) {
    return {
      sourceLang: nativeLang,
      targetLangs: learningLangs,
      detectedLang,
    };
  }

  // Case 3: Detected one of the learning languages → reverse direction
  if (learningLangs.includes(detectedLang)) {
    return {
      sourceLang: detectedLang,
      targetLangs: [nativeLang, ...learningLangs.filter((l) => l !== detectedLang)],
      detectedLang,
    };
  }

  // Shouldn't reach here since detectLanguage only returns candidates,
  // but fallback to standard direction for safety.
  return {
    sourceLang: nativeLang,
    targetLangs: learningLangs,
    detectedLang: undefined,
  };
}

/**
 * Resolve translation direction from an explicit source language (no detection).
 *
 * Used when the user has manually selected the source language for the next
 * translation (Task 17: Post-Translation Source Language Selection Menu).
 *
 * Logic:
 * 1. If sourceLang === nativeLang → targets = learningLangs
 * 2. If sourceLang is one of learningLangs → targets = [nativeLang, ...remaining learningLangs]
 * 3. If sourceLang is not in config → returns null (invalid, caller should reset)
 *
 * @param input - Explicit source language, native language, and learning languages
 * @returns Resolved direction (detectedLang = undefined), or null if source is invalid
 *
 * Pure function — no side effects, no I/O.
 */
export function resolveDirectionFromSource(
  input: ResolveFromSourceInput,
): TranslationDirection | null {
  const { sourceLang, nativeLang, learningLangs } = input;

  // Source is native language → standard direction
  if (sourceLang === nativeLang) {
    return {
      sourceLang: nativeLang,
      targetLangs: learningLangs,
      detectedLang: undefined,
    };
  }

  // Source is one of the learning languages → reverse direction
  if (learningLangs.includes(sourceLang)) {
    return {
      sourceLang,
      targetLangs: [nativeLang, ...learningLangs.filter((l) => l !== sourceLang)],
      detectedLang: undefined,
    };
  }

  // Source language not in user's config → invalid
  return null;
}

import { detectLanguage } from "./detect-language.js";
import type { ResolveDirectionInput, TranslationDirection } from "./types.js";

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

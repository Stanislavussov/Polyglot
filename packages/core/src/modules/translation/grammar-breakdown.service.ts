/**
 * Grammar Breakdown Service — on-demand constructional grammar analysis.
 *
 * Generates high-level grammar pattern breakdowns for translations.
 * Used when grammar breakdown is requested via button callback
 * (sentences always, phrases when grammar is OFF in template).
 */

import { z } from "zod";
import { getLanguageName } from "../i18n/language-registry.js";
import type { GenerateObjectFn } from "./translation.service.js";

export interface GrammarBreakdownInput {
  /** Original text that was translated */
  originalText: string;
  /** Translations per target language: langCode → translated text */
  translations: Record<string, string>;
  /** Source language code */
  sourceLang: string;
  /** Target language codes */
  targetLangs: string[];
  /** User's native language code */
  nativeLang: string;
  /** Input classification — affects item count limit */
  inputType: "phrase" | "sentence";
}

const grammarBreakdownSchema = z.object({
  grammarBreakdown: z.record(z.string(), z.array(z.string().min(1)).min(1).max(5)),
});

/**
 * Generate grammar breakdown for translations on-demand.
 *
 * Returns a Record of langCode → string[] (constructional patterns).
 */
export async function generateGrammarBreakdown(
  input: GrammarBreakdownInput,
  generateObjectFn: GenerateObjectFn,
  model: string,
  userId?: number,
): Promise<Record<string, string[]>> {
  const { originalText, translations, sourceLang, targetLangs, nativeLang, inputType } = input;

  const nativeLangName = getLanguageName(nativeLang);
  const sourceLangName = getLanguageName(sourceLang);
  const itemLimit = inputType === "sentence" ? "4-5" : "2-3";

  const translationLines = targetLangs
    .map((lang) => {
      const text = translations[lang];
      if (!text) return null;
      return `  ${lang.toUpperCase()} (${getLanguageName(lang)}): "${text}"`;
    })
    .filter(Boolean)
    .join("\n");

  const prompt = `Analyze the grammatical constructions used in the following translations.

Original (${sourceLangName}): "${originalText}"
Translations:
${translationLines}

For each target language, provide ${itemLimit} high-level grammatical CONSTRUCTIONS or PATTERNS used in the translation. NEVER list individual words with their parts of speech — that is NOT what this analysis is for.

Rules:
- Describe grammatical constructions: tense, mood, case usage, clause structure, word order patterns.
- Grammar terms (e.g. Akkusativ, Konjunktiv II, Partizip II, Subjuntivo) must stay in the target language.
- Explanations must be written in ${nativeLangName}.
- Each item should describe one grammatical construction or pattern, not a single word.
- Good examples: "auf + Akkusativ — направление движения", "hätte + Partizip II — Konjunktiv II, нереальное действие в прошлом", "Préterito perfecto — завершённое действие в прошлом".
- Bad examples (NEVER do this): "Er — подлежащее", "ist — глагол", "Schurke — существительное". This is word-by-word labeling and is strictly forbidden.
- Return ONLY valid JSON matching the provided schema. No markdown, no explanation, no code fences.`;

  const result = await generateObjectFn(prompt, grammarBreakdownSchema, model, { userId });
  return result.grammarBreakdown;
}

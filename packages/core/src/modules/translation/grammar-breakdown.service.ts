/**
 * Grammar Breakdown Service — on-demand constructional grammar analysis.
 *
 * Generates high-level grammar pattern breakdowns for translations.
 * Used when grammar breakdown is requested via button callback
 * (sentences always, phrases when grammar is OFF in template).
 */

import { z } from "zod";
import type { GenerateObjectFn } from "../../ports/ai.port.js";
import { getLanguageName } from "../i18n/language-registry.js";

/**
 * Enforced here rather than in the schema: `maxItems` is among the keywords
 * strict structured outputs reject, so the count lives in the prompt and the
 * ceiling lives in code.
 */
const MAX_BREAKDOWN_ITEMS = 5;

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

/**
 * A fixed shape, not `z.record(langCode, items)`, and that is the whole point:
 * a dynamic-key object compiles to `additionalProperties: {…}`, which neither
 * OpenAI's strict structured outputs nor Gemini's `responseSchema` accept — the
 * provider rejects the request before the model ever sees it, so the button
 * failed for every user on every card. A list of `{ lang, items }` says the same
 * thing with keys the schema can name.
 */
const grammarBreakdownSchema = z.object({
  languages: z.array(
    z.object({
      lang: z.string().min(2),
      items: z.array(z.string().min(1)),
    }),
  ),
});

/**
 * Generate grammar breakdown for translations on-demand.
 *
 * Returns a Record of langCode → string[] (constructional patterns), carrying
 * only languages that were actually asked about and actually came back with
 * items — a language with an empty list would render as a dead header.
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
- Return one entry per target language, with "lang" set to that language's code exactly as shown above (${targetLangs.join(", ")}).
- Return ONLY valid JSON matching the provided schema. No markdown, no explanation, no code fences.`;

  const result = await generateObjectFn(prompt, grammarBreakdownSchema, model, { userId });

  const requested = new Map(targetLangs.map((code) => [code.toLowerCase(), code]));
  const breakdown: Record<string, string[]> = {};
  for (const entry of result.languages) {
    // The prompt prints the codes uppercased, so a model echoing "DE" is normal
    // rather than wrong; anything not asked for is dropped instead of rendered.
    const code = requested.get(entry.lang.trim().toLowerCase());
    if (!code) continue;
    const items = entry.items.map((item) => item.trim()).filter((item) => item.length > 0);
    if (items.length === 0) continue;
    breakdown[code] = items.slice(0, MAX_BREAKDOWN_ITEMS);
  }
  return breakdown;
}

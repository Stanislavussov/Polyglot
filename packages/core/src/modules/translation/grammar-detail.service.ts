/**
 * Grammar Detail Service — detailed grammatical explanation for a single language.
 *
 * Second tier of grammar analysis: takes the brief grammar breakdown
 * and generates a detailed explanation with variations and examples
 * for memorization. Uses generateText (free-form), not generateObject.
 */

import { getLanguageName } from "../i18n/language-registry.js";

export interface GrammarDetailInput {
  /** Original text that was translated */
  originalText: string;
  /** Translation in the selected target language */
  translation: string;
  /** Target language code (e.g. "de", "cs") */
  langCode: string;
  /** User's native language code */
  nativeLang: string;
  /** Brief grammar breakdown items already shown to user */
  grammarBreakdown: string[];
}

/**
 * Generate detailed grammar explanation for a single language translation.
 *
 * Returns plain text (not HTML) — the bot wraps it with a header before sending.
 */
export async function generateGrammarDetail(
  input: GrammarDetailInput,
  generateTextFn: (prompt: string, model: string, options?: { userId?: number }) => Promise<string>,
  model: string,
  userId?: number,
): Promise<string> {
  const { originalText, translation, langCode, nativeLang, grammarBreakdown } = input;

  const targetLangName = getLanguageName(langCode);
  const nativeLangName = getLanguageName(nativeLang);

  const breakdownList = grammarBreakdown.map((item, i) => `${i + 1}. ${item}`).join("\n");

  const prompt = `You are a language teacher explaining ${targetLangName} grammar to a ${nativeLangName}-speaking student.

The student translated "${originalText}" and got the ${targetLangName} translation: "${translation}".

They already saw this brief grammar breakdown:
${breakdownList}

Now explain each grammatical construction in detail. For each one:
1. Explain WHY this construction is used here (not just what it is).
2. Show 2-3 similar examples using the same pattern in different contexts.
3. Mention common mistakes or pitfalls learners make with this construction.

Write everything in ${nativeLangName}. Grammar terms (e.g. Akkusativ, Konjunktiv II, Subjuntivo) must stay in ${targetLangName}.

Keep the explanation concise but thorough — aim for practical understanding, not academic depth. Do not use any HTML or markdown formatting — plain text only.`;

  return generateTextFn(prompt, model, { userId });
}

/**
 * Etymology Service — on-demand origin-and-meaning analysis.
 *
 * Generates a concise etymology for the original input term (a word or short
 * phrase in a language the user is learning). Used when etymology is requested
 * via button callback. The explanation is written in the learner's native
 * language so they can understand where the term comes from and how it acquired
 * its current meaning.
 */

import { z } from "zod";
import type { GenerateObjectFn } from "../../ports/ai.port.js";
import { getLanguageName } from "../i18n/language-registry.js";

export interface EtymologyInput {
  /** Original term that was translated (source-language headword) */
  originalText: string;
  /** Source language code — the term's own language */
  sourceLang: string;
  /** User's native language code — language the explanation is written in */
  nativeLang: string;
  /** Input classification — words and short phrases only */
  inputType: "word" | "phrase";
}

const etymologySchema = z.object({
  etymology: z.string().min(1),
});

/**
 * Generate a concise etymology for the original term on-demand.
 *
 * Returns a 2–4 sentence prose explanation written in the native language.
 */
export async function generateEtymology(
  input: EtymologyInput,
  generateObjectFn: GenerateObjectFn,
  model: string,
  userId?: number,
): Promise<string> {
  const { originalText, sourceLang, nativeLang } = input;

  const nativeLangName = getLanguageName(nativeLang);
  const sourceLangName = getLanguageName(sourceLang);

  const prompt = `Explain the etymology of the following ${sourceLangName} term.

Term (${sourceLangName}): "${originalText}"

Write a concise etymology of 2 to 4 sentences that helps a learner understand where the term comes from and how it acquired its current meaning.

Rules:
- Cover the origin (root language, ancestral form or morphemes) and how the meaning developed into its present sense.
- For idioms or set phrases, explain the original literal image and how it became figurative.
- Be accurate; if the origin is genuinely uncertain or disputed, say so briefly instead of inventing one.
- The explanation must be written in ${nativeLangName}.
- Keep proper nouns and ancestral word forms in their original script where relevant.
- Return ONLY valid JSON matching the provided schema. No markdown, no code fences.`;

  const result = await generateObjectFn(prompt, etymologySchema, model, { userId });
  return result.etymology;
}

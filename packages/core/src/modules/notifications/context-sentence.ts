/**
 * Contextual notification sentence — prompt + schema.
 *
 * Owned by core (not the notifications adapter) so the prompt engineering lives
 * next to the rest of the AI prompt builders and can be tested in isolation.
 *
 * The natural-language instructions reference human-readable language NAMES
 * (resolved from the language registry) instead of raw ISO codes — asking the
 * model to "write in Russian" rather than the meaningless "write in ru". The
 * machine-readable JSON stays keyed by ISO code, since downstream rendering
 * looks translations up by code.
 */

import { z } from "zod";
import { getLanguageName } from "../i18n/language-registry.js";

/** Structured contextual sentence returned by the model. */
export const contextualSentenceSchema = z.object({
  sentence: z.string().describe("A natural sentence in the target language"),
  translations: z
    .record(z.string(), z.string())
    .describe("Translations of the sentence into other languages, keyed by language code"),
});

export type ContextualSentence = z.infer<typeof contextualSentenceSchema>;

/**
 * Builds the prompt for a contextual notification sentence.
 *
 * @param context   - The user's chosen context/topic (free text).
 * @param langCodes - Interface + learning language codes; the first is the
 *                    language the sentence is written in, the rest are targets.
 * @returns A prompt whose instructions name the languages while keeping the
 *          requested JSON keyed by ISO code.
 */
export function buildContextSentencePrompt(context: string, langCodes: string[]): string {
  const primaryCode = langCodes[0] ?? "en";
  const primaryName = getLanguageName(primaryCode);
  const langList = langCodes.map((code) => `${getLanguageName(code)} (${code})`).join(", ");

  return `You are a language learning assistant. Generate a useful, natural sentence relevant to this context: "${context}"

Requirements:
- The sentence should be 8-15 words
- It should be practical and useful for everyday communication
- Write the sentence in ${primaryName}
- Then translate it into these languages: ${langList}

Return ONLY valid JSON with this structure, keyed by ISO language code:
{
  "sentence": "the sentence in ${primaryName}",
  "translations": {
    "${primaryCode}": "the sentence in ${primaryName}",
    "<language_code>": "translation"
  }
}

Do NOT include any text outside the JSON.`;
}

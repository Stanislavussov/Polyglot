import type { InputType } from "../input-analysis/types.js";
import type { PreflightScoringConfig } from "./preflight.config.js";

export interface BuildPreflightPromptInput {
  text: string;
  sourceLang: string;
  targetLangs: readonly string[];
  nativeLang?: string;
  interfaceLang?: string;
  inputType: InputType;
  detectionConfidence: number;
  config: PreflightScoringConfig;
}

export function buildPreflightPrompt(input: BuildPreflightPromptInput): string {
  const userLanguages = [input.nativeLang, input.sourceLang, ...input.targetLangs].filter(
    (lang, index, all): lang is string => lang !== undefined && all.indexOf(lang) === index,
  );

  return `You are a preflight ambiguity checker for a language-learning translation app.

Input text: ${JSON.stringify(input.text)}
Input type: ${input.inputType}
Current source-language guess: ${input.sourceLang}
Target languages: ${input.targetLangs.join(", ")}
User native language: ${input.nativeLang ?? "unknown"}
User configured languages: ${userLanguages.join(", ")}
Upstream language-detection confidence: ${input.detectionConfidence.toFixed(2)}
User interface language: ${input.interfaceLang ?? "en"}

Return ONLY JSON matching the provided schema.

Scoring policy:
- confidence is your confidence that translation can proceed without asking the user.
- If confidence >= ${input.config.autoProceedAboveConfidence}, outcome should usually be "proceed".
- If confidence < ${input.config.clarifyBelowConfidence}, do not proceed silently. Return a clarification outcome.
- Use clarification for actual uncertainty, not just because multiple languages use the Latin alphabet.
- Do not ask about ordinary dictionary polysemy, parts of speech, or common noun/adjective senses for a single known word. Proceed with translation.

Typo / error-severity policy:
- MINOR typo → outcome "proceed_with_correction": the correction is unambiguous AND the input does not read as a valid word in any of the user's configured languages, AND there is no other meaningful reading. Put the fixed text in "correctedText" and briefly explain the fix in "explanation". Do not use options.
- SEVERE / ambiguous typo → outcome "confirm_typo_suggestion": there are multiple plausible corrections, OR the input is a valid word in another configured language, OR the construction is fully broken. Options must include 1-3 typo_correction choices and one translate_as_written choice. If the input is total gibberish with no confident correction, offer ONLY translate_as_written (no typo_correction option).
- When in doubt between minor and severe, prefer "confirm_typo_suggestion" — never silently change a word the user may have meant.

Sentence / phrase policy:
- Almost never re-ask about sentences or phrases. When the intended meaning is confidently reconstructable despite typos or broken grammar, use "proceed_with_correction": put the fully corrected sentence in "correctedText" and explain the main errors in "explanation" (1-2 short sentences).
- Use "confirm_typo_suggestion" for a sentence/phrase ONLY when its meaning cannot be confidently reconstructed.

Outcome rules:
- "proceed": no clarification or correction needed.
- "proceed_with_correction": input has a minor unambiguous typo or a reconstructable broken sentence; "correctedText" is required.
- "clarify_source_language": same spelling is plausibly a different word in multiple user languages, especially with different meanings. Options must be source_language choices.
- "clarify_meaning": use only when the input is a phrase or short expression whose intended meaning cannot be translated without context. Do not use it for a single word such as "patient" that has normal dictionary senses.
- "confirm_typo_suggestion": input likely contains a severe or ambiguous typo (see severity policy).
- "clarify_format": date, number, placeholder, mixed scripts, or formatting ambiguity needs user choice.
- "reject": input is not translatable or unsafe to process as a translation request.

Option requirements:
- At most ${input.config.maxOptions} options.
- Write "explanation" in the user's native language (${input.nativeLang ?? "en"}). Keep it to 1-2 short sentences.
- Option labels must be in the user's native language (${input.nativeLang ?? "en"}).
- For source_language options, set langCode to the candidate source language and DO NOT put any language name in the label — the app adds a flag from langCode. Use the word/sense itself as the label.
- For typo_correction options, set correctedText to the corrected text and set langCode when the corrected word's source language is clear.
- Always make options concrete enough that a Telegram button label is useful.`;
}

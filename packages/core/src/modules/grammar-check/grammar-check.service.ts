/**
 * Grammar check — one learner text in, a structured list of its mistakes out.
 *
 * The model reports the language it detected; the service, not the prompt, is
 * what refuses a text outside the user's native + learning languages, so a model
 * that "helpfully" checks a third language still cannot spend a check on it.
 */
import type { GenerateObjectFn, GenerateOptions } from "../../ports/ai.port.js";
import { normalizeToIso1 } from "../i18n/language-registry.js";
import { buildGrammarCheckPrompt, type GrammarCheckPromptInput } from "./grammar-check.prompt.js";
import { type GrammarIssue, grammarCheckResultSchema } from "./grammar-check.schema.js";

export type GrammarCheckInput = GrammarCheckPromptInput;

export type GrammarCheckOutcome =
  | {
      status: "checked";
      /** ISO 639-1 code of the checked text's language. */
      language: string;
      errors: GrammarIssue[];
      correctedText: string;
      /** Set only for a correct text, and only when it differs from what the learner wrote. */
      naturalAlternative: string | null;
    }
  | { status: "unsupported_language"; detectedLanguage: string };

export async function checkGrammar(
  input: GrammarCheckInput,
  generateObjectFn: GenerateObjectFn,
  model: string,
  options?: GenerateOptions,
): Promise<GrammarCheckOutcome> {
  const raw = await generateObjectFn(buildGrammarCheckPrompt(input), grammarCheckResultSchema, model, options);

  const reported = raw.detectedLanguage.trim();
  const language = normalizeToIso1(reported) ?? reported.toLowerCase();
  const checkable = new Set([input.nativeLang, ...input.learningLangs]);
  if (!checkable.has(language)) {
    return { status: "unsupported_language", detectedLanguage: language };
  }

  // Correctness is derived from the issues, never taken as a separate claim: a
  // "correct" verdict next to a list of mistakes would render as both.
  const errors = raw.errors;
  const alternative = raw.naturalAlternative?.trim() ?? "";
  const naturalAlternative =
    errors.length === 0 && alternative !== "" && alternative !== input.text.trim() ? alternative : null;
  const correctedText = raw.correctedText.trim() || input.text.trim();

  return { status: "checked", language, errors, correctedText, naturalAlternative };
}

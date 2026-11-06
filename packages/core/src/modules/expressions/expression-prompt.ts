import { getLanguageName } from "../i18n/language-registry.js";
import type { ExpressionAngle } from "./expression-angle.js";

/** Keeps the prompt lean; older items have already rotated out of the 24h window anyway. */
export const MAX_AVOIDED_EXPRESSIONS = 20;

export interface ExpressionPromptInput {
  angle: ExpressionAngle;
  nativeLang: string;
  /** Recently sent expressions the model must not repeat. */
  avoid: readonly string[];
}

export function buildExpressionPrompt({ angle, nativeLang, avoid }: ExpressionPromptInput): string {
  const language = getLanguageName(angle.lang);
  const native = getLanguageName(nativeLang);
  const isNative = angle.lang === nativeLang;
  const avoided = avoid.slice(0, MAX_AVOIDED_EXPRESSIONS);

  const avoidBlock =
    avoided.length > 0 ? `\nDo not repeat any of these: ${avoided.map((a) => `"${a}"`).join(", ")}.\n` : "";

  const translationLine = isNative
    ? ""
    : `\n  "translation": "close translation into ${native}, or the ${native} equivalent saying if one exists",`;

  return `You help a person speak more vividly and expressively. Give ONE expression in ${language}.

Kind: ${angle.category}
Theme: ${angle.theme}
Tone: ${angle.tone}

Rules:
- It must be real and widely recognised by native ${language} speakers. Never invent quotes, films, books or people; if unsure of the exact wording, choose a different, well-known one.
- Prefer a fresh, less obvious pick over the most clichéd one.
- Name the real source (title of the film, series, book or song, or the person's name) when there is one.
- The meaning is 1-2 short sentences in ${native}: what it means and when to say it.
- The example is one everyday sentence in ${language}, the way a person would say it today.
${avoidBlock}
Return ONLY JSON:
{
  "expression": "the expression in ${language}",
  "meaning": "explanation in ${native}",${translationLine}
  "sourceKind": "film | series | book | person | song | folk | history | sport | other",
  "sourceTitle": "real source name, omit for folk sayings",
  "example": "example sentence in ${language}"
}`;
}

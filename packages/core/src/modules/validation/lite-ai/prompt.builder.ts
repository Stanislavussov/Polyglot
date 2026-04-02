/**
 * Lite AI Validation — Prompt Builder
 *
 * Builds a prompt instructing a lightweight AI model to evaluate
 * translation quality on structured dimensions (meaning, naturalness,
 * register, CEFR accuracy).
 *
 * The validator scores — it does NOT rewrite translations.
 *
 * Pure function — no side effects, no I/O.
 */

import type { DictionaryContext, LanguageTranslation } from "../../translation/types.js";
import type { LiteValidationInput } from "./types.js";

/**
 * Build a validation prompt for the lite AI model.
 *
 * The prompt includes:
 * - Original word/phrase and source language
 * - Each target language translation with its metadata
 * - The scoring rubric (meaning, naturalness, register, CEFR)
 * - Instruction to return JSON matching the schema
 * - Explicit instruction NOT to rewrite — only score
 * - Dictionary context (if available) for reference
 */
export function buildLiteValidationPrompt(input: LiteValidationInput): string {
  const { original, sourceLang, translations, dictionaryContext } = input;

  const targetLangs = Object.keys(translations);
  const translationBlock = buildTranslationBlock(translations);
  const dictionaryBlock = dictionaryContext ? buildDictionaryBlock(dictionaryContext) : "";

  return `You are a translation quality evaluator. Your job is to SCORE translations — NOT rewrite them.

ORIGINAL: "${original}" (source language: ${sourceLang})

TRANSLATIONS TO EVALUATE:
${translationBlock}
${dictionaryBlock}
SCORING RUBRIC (0–5 scale for each dimension):

1. meaningPreserved (0–5): Does the translation accurately convey the original meaning?
   0 = completely wrong meaning, 5 = perfect semantic match

2. naturalness (0–5): Does the translation sound natural to a native speaker?
   0 = ungrammatical/awkward, 5 = perfectly natural

3. registerAccuracy (0–5): Is the register (formality level) correctly assigned?
   0 = completely wrong register, 5 = perfectly matched

4. cefrAccuracy (0–5): Is the CEFR level (A1–C2) correctly assigned?
   0 = off by 3+ levels, 5 = exact match

5. overallScore (0–5): Overall translation quality considering all dimensions.
   0 = unusable, 3 = acceptable, 5 = excellent

INSTRUCTIONS:
- Score each target language translation independently.
- Provide a brief "reasoning" explaining your scores for each language.
- Do NOT suggest alternative translations — only score the given ones.
- Return ONLY valid JSON, no markdown, no explanation, no code fences.

Return JSON with this exact structure:
{
  "scores": {
${targetLangs.map((lang) => `    "${lang}": { "meaningPreserved": <0-5>, "naturalness": <0-5>, "registerAccuracy": <0-5>, "cefrAccuracy": <0-5>, "overallScore": <0-5>, "reasoning": "<brief explanation>" }`).join(",\n")}
  }
}`;
}

/**
 * Build the translations block showing each language's translation data.
 */
function buildTranslationBlock(translations: Record<string, LanguageTranslation>): string {
  const lines: string[] = [];

  for (const [lang, data] of Object.entries(translations)) {
    lines.push(`[${lang}]`);
    lines.push(`  text: "${data.text}"`);
    lines.push(`  register: ${data.register}`);
    lines.push(`  cefr: ${data.cefr}`);
    if (data.expressionType) {
      lines.push(`  expressionType: ${data.expressionType}`);
    }
    if (data.equivalentNote) {
      lines.push(`  equivalentNote: "${data.equivalentNote}"`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build dictionary context reference block.
 * Gives the validator authoritative data to check translations against.
 */
function buildDictionaryBlock(ctx: DictionaryContext): string {
  const lines: string[] = [
    "DICTIONARY REFERENCE (Wiktionary):",
    `  word: "${ctx.word}" (${ctx.langCode}), POS: ${ctx.pos}`,
  ];

  if (ctx.glosses.length > 0) {
    lines.push(`  definitions: ${ctx.glosses.slice(0, 5).map((g) => `"${g}"`).join(", ")}`);
  }

  return `\n${lines.join("\n")}\n`;
}

/**
 * Prompt Builder — constructs AI prompts for translation requests.
 *
 * Builds multi-language prompts that produce output matching
 * translationResultSchema exactly. Requests emoji, register,
 * CEFR level, transcription, synonyms, and example sentences.
 */
import type { TranslationRequest } from "./types.js";

/**
 * Builds the primary translation prompt.
 *
 * Translates a word/phrase from sourceLang to ALL targetLangs in a single request.
 * The output format matches translationResultSchema — JSON, no markdown.
 */
export function buildTranslationPrompt(request: TranslationRequest): string {
  const { text, sourceLang, targetLangs, topic } = request;

  const topicHint = topic
    ? `\nThe word is used in the context of: "${topic}".`
    : "";

  const targetLangsList = targetLangs.join(", ");

  return `Translate "${text}" from ${sourceLang} to ${targetLangsList}.${topicHint}

Return ONLY valid JSON, no markdown, no explanation, no code fences.
The JSON must have this exact structure:
{
  "emoji": "<one relevant emoji>",
  "register": "<overall register: slang | colloquial | neutral | literary | professional>",
  "translations": {
${targetLangs.map((lang) => `    "${lang}": {
      "text": "<translation in ${lang}>",
      "cefr": "<CEFR level: A1 | A2 | B1 | B2 | C1 | C2>",
      "transcription": "<IPA transcription if applicable, otherwise omit>",
      "register": "<register: slang | colloquial | neutral | literary | professional>",
      "synonyms": [
        { "text": "<synonym>", "register": "<register>" }
      ],
      "examples": [
        { "context": "formal", "target": "<formal example sentence in ${lang}>", "native": "<same sentence in ${sourceLang}>" },
        { "context": "colloquial", "target": "<casual example sentence in ${lang}>", "native": "<same sentence in ${sourceLang}>" },
        { "context": "professional", "target": "<professional example sentence in ${lang}>", "native": "<same sentence in ${sourceLang}>" }
      ]
    }`).join(",\n")}
  }
}

Rules:
- Each example sentence MUST contain the translated word (or its inflected form).
- Provide 2–3 synonyms per language with their register.
- Provide exactly 3 example sentences per language (formal, colloquial, professional).
- CEFR level should reflect the difficulty of the translated word in that language.
- Transcription is required for non-Latin scripts; optional otherwise.
- Return ONLY the JSON object. No additional text before or after.`;
}

/**
 * Builds a stricter retry prompt when the first attempt failed validation.
 *
 * Includes explicit error feedback so the AI can correct its output.
 */
export function buildStrictPrompt(
  request: TranslationRequest,
  errors: string[],
): string {
  const base = buildTranslationPrompt(request);

  const errorFeedback = errors.map((e) => `  - ${e}`).join("\n");

  return `${base}

IMPORTANT: Your previous response had validation errors:
${errorFeedback}

Please fix these issues and return a corrected JSON response.
Double-check that:
- Every example sentence contains the translated word or its form
- Translations are actual translations, not the original word repeated
- All required fields are present
- Register values are exactly one of: slang, colloquial, neutral, literary, professional
- CEFR values are exactly one of: A1, A2, B1, B2, C1, C2`;
}

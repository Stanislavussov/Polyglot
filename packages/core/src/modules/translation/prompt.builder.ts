/**
 * Prompt Builder — constructs AI prompts for translation requests.
 *
 * Builds multi-language prompts that produce output matching
 * translationResultSchema exactly. Requests emoji, register,
 * CEFR level, transcription, synonyms, and example sentences.
 */
import type { TranslationRequest, DictionaryContext } from "./types.js";

/**
 * Builds the primary translation prompt.
 *
 * Translates a word/phrase from sourceLang to ALL targetLangs in a single request.
 * The output format matches translationResultSchema — JSON, no markdown.
 */
export function buildTranslationPrompt(request: TranslationRequest): string {
  const { text, sourceLang, targetLangs, topic, dictionaryContext } = request;

  const topicHint = topic
    ? `\nThe word is used in the context of: "${topic}".`
    : "";

  const dictionaryHint = dictionaryContext
    ? buildDictionaryHint(dictionaryContext)
    : "";

  const targetLangsList = targetLangs.join(", ");

  return `Translate "${text}" from ${sourceLang} to ${targetLangsList}.${dictionaryHint}${topicHint}

Return ONLY valid JSON, no markdown, no explanation, no code fences.
The JSON must have this exact structure:
{
  "emoji": "<one relevant emoji>",
  "register": "<overall register: slang | colloquial | neutral | literary | professional>",
  "translations": {
${targetLangs
  .map(
    (lang) => `    "${lang}": {
      "text": "<translation in ${lang}>",
      "cefr": "<CEFR level: A1 | A2 | B1 | B2 | C1 | C2>",
      "transcription": "<IPA transcription if applicable, otherwise omit>",
      "register": "<register: slang | colloquial | neutral | literary | professional>",
      "expressionType": "<literal | idiomatic_equivalent — omit or set to literal for direct translations>",
      "equivalentNote": "<brief note explaining why an idiomatic equivalent was chosen — omit for literal>",
      "synonyms": [
        { "text": "<synonym>", "register": "<register>" }
      ],
      "alternatives": [
        { "text": "<alternative translation 1>", "register": "<register>", "synonyms": [{ "text": "<syn>", "register": "<reg>" }] },
        { "text": "<alternative translation 2>", "register": "<register>", "synonyms": [{ "text": "<syn>", "register": "<reg>" }] }
      ],
      "examples": [
        { "context": "formal", "target": "<formal example sentence in ${lang}>", "native": "<same sentence in ${sourceLang}>" },
        { "context": "colloquial", "target": "<casual example sentence in ${lang}>", "native": "<same sentence in ${sourceLang}>" },
        { "context": "professional", "target": "<professional example sentence in ${lang}>", "native": "<same sentence in ${sourceLang}>" }
      ]
    }`,
  )
  .join(",\n")}
  }
}

Rules:
- VARIETY IN EXAMPLES IS MANDATORY: Each of the 3 example sentences MUST use a DIFFERENT word or expression. Specifically:
  * Example 1 (formal): use the main translation ("text" field).
  * Example 2 (colloquial): use the first alternative translation or a synonym — NOT the main translation.
  * Example 3 (professional): use the second alternative translation or a different synonym — NOT the main translation and NOT the same as example 2.
  This applies to BOTH the "target" AND "native" sentences. NEVER repeat the same word/phrase across all 3 examples.
- Provide 2–3 synonyms per language with their register.
- Provide exactly 2 alternative translations per language in the \`alternatives\` array. Each alternative should be a different valid translation with its own register and 1–2 synonyms.
- Provide exactly 3 example sentences per language (formal, colloquial, professional).
- CEFR level should reflect the difficulty of the translated word in that language.
- Transcription is required for non-Latin scripts; optional otherwise.
- Return ONLY the JSON object. No additional text before or after.

Idiomatic & Proverb Rule:
- If the input is a proverb, idiom, fixed expression, or culturally-bound phrase
  that has no natural direct equivalent in a target language, provide the CLOSEST
  FUNCTIONAL EQUIVALENT in that language (a proverb, idiom, slang term, or common
  speech expression that conveys the same meaning).
- In this case, set expressionType to "idiomatic_equivalent" and provide a brief
  equivalentNote explaining the choice.
- If a direct translation exists and is natural, set expressionType to "literal"
  (or omit it).
- NEVER return a meaningless word-for-word rendering of an idiomatic expression
  when a functional equivalent exists.`;
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
- Each of the 3 examples uses a DIFFERENT word: example 1 uses the main translation, example 2 uses an alternative/synonym, example 3 uses another alternative/synonym — in both target and native sentences
- Translations are actual translations, not the original word repeated
- All required fields are present
- Register values are exactly one of: slang, colloquial, neutral, literary, professional
- CEFR values are exactly one of: A1, A2, B1, B2, C1, C2
- For idiomatic expressions, set expressionType to "idiomatic_equivalent" with an equivalentNote`;
}

/**
 * Builds a dictionary context hint block for the AI prompt.
 *
 * Inserts Wiktionary offline data (POS, glosses) to guide the AI
 * toward the correct sense of the word and improve translation quality.
 *
 * Placed BEFORE the JSON template so the AI sees authoritative definitions
 * before forming its translation.
 */
function buildDictionaryHint(ctx: DictionaryContext): string {
  const lines: string[] = [
    "",
    "IMPORTANT — Authoritative Dictionary Context (Wiktionary):",
    `Word: "${ctx.word}" (${ctx.langCode}), part of speech: ${ctx.pos}.`,
  ];

  if (ctx.glosses.length > 0) {
    const glossList = ctx.glosses
      .slice(0, 5) // Limit to avoid prompt bloat
      .map((g) => `"${g}"`)
      .join(", ");
    lines.push(`The verified meaning of this word is: ${glossList}.`);
    lines.push(
      "You MUST use these definitions as the PRIMARY basis for your translation. " +
        "The main translation, alternatives, and synonyms should all reflect these meanings. " +
        "If the word has multiple senses listed above, each alternative should capture a different sense.",
    );
  }

  if (ctx.formTags && ctx.formTags.length > 0) {
    lines.push(`Form tags: ${ctx.formTags.join(", ")}.`);
  }

  if (ctx.pos === "phrase" || ctx.pos === "idiom") {
    lines.push(
      "This is a fixed expression — translate the meaning, not word-by-word.",
    );
  }

  return "\n" + lines.join("\n");
}

/**
 * Prompt Builder — constructs AI prompts for translation requests.
 *
 * Builds multi-language prompts that produce output matching
 * translationResultSchema exactly. Requests emoji, transcription,
 * synonyms, and example sentences.
 */

import { getLanguageName } from "../i18n/language-registry.js";
import type { DictionaryContext, TranslationOutputConfig, TranslationRequest } from "./types.js";

/**
 * Resolve output config — all fields default to true when absent.
 * Ensures backward compatibility: undefined or {} produces full output.
 */
function resolveConfig(config?: TranslationOutputConfig): Required<TranslationOutputConfig> {
  return {
    includeExamples: config?.includeExamples !== false,
    includeTranscription: config?.includeTranscription !== false,
    includeSynonyms: config?.includeSynonyms !== false,
    includeAlternatives: config?.includeAlternatives !== false,
    includeEquivalentNote: config?.includeEquivalentNote !== false,
    includeConnotationWarning: config?.includeConnotationWarning !== false,
    includeNativeSynonyms: config?.includeNativeSynonyms !== false,
  };
}

/**
 * Builds the primary translation prompt.
 *
 * Translates a word/phrase from sourceLang to ALL targetLangs in a single request.
 * The output format matches translationResultSchema — JSON, no markdown.
 */
export function buildTranslationPrompt(request: TranslationRequest): string {
  const { text, sourceLang, targetLangs, nativeLang, topic, dictionaryContext, outputConfig, inputType } = request;
  const cfg = resolveConfig(outputConfig);
  const isSentence = inputType === "sentence";

  const topicHint = topic ? buildTopicHint(topic, isSentence, cfg) : "";

  const dictionaryHint = dictionaryContext ? buildDictionaryHint(dictionaryContext, cfg) : "";

  const sourceLangName = getLanguageName(sourceLang);
  const targetLangNames = targetLangs.map((l) => getLanguageName(l)).join(", ");
  const nativeLangName = nativeLang ? getLanguageName(nativeLang) : null;
  const includesSourceTarget = targetLangs.includes(sourceLang);

  const intro = isSentence
    ? `Translate the following sentence from ${sourceLangName} to ${targetLangNames}:\n"${text}"`
    : `Translate "${text}" from ${sourceLangName} to ${targetLangNames}.`;

  const requestedFields = ["translation text"];
  if (cfg.includeTranscription) requestedFields.push("short IPA transcription when useful, otherwise null");
  if (cfg.includeSynonyms) requestedFields.push("2-3 close synonyms");
  if (cfg.includeAlternatives) requestedFields.push("exactly 2 alternative translations");
  if (cfg.includeExamples) {
    requestedFields.push(
      nativeLangName
        ? `exactly 3 short examples with native translations in ${nativeLangName}`
        : "exactly 3 short examples",
    );
  }
  if (cfg.includeEquivalentNote) requestedFields.push("idiom/equivalent metadata only when needed");
  if (cfg.includeConnotationWarning) {
    requestedFields.push(
      nativeLangName
        ? `connotation warning in ${nativeLangName} only for risky meanings`
        : "connotation warning only for risky meanings",
    );
  }
  if (cfg.includeNativeSynonyms && nativeLangName) requestedFields.push(`2-3 source synonyms in ${nativeLangName}`);

  return `${intro}${topicHint}${dictionaryHint}

Return ONLY valid JSON matching the provided schema. No markdown, no explanation, no code fences.
For each target language (${targetLangs.join(", ")}), provide: ${requestedFields.join("; ")}.
Also include one relevant emoji.
Prefer ONE natural, accurate main translation. Do not invent extra nuance.

Rules:${
    includesSourceTarget
      ? `
- If a target language is the same as the source language, keep the main expression in that language and provide same-language learning details/examples for it.`
      : ""
  }${
    cfg.includeExamples
      ? `
- VARIETY IN EXAMPLES IS MANDATORY: Each of the 3 example sentences MUST use a DIFFERENT word or expression. Specifically:
  * Example 1: use the main translation ("text" field).
  * Example 2: use the first alternative translation or a synonym — NOT the main translation.
  * Example 3: use the second alternative translation or a different synonym — NOT the main translation and NOT the same as example 2.
  This applies to the "target" sentences. NEVER repeat the same word/phrase across all 3 examples.${
    nativeLangName
      ? `
- Each example MUST include "native": the same example sentence translated into ${nativeLangName}.`
      : ""
  }`
      : ""
  }${
    cfg.includeSynonyms
      ? `
- Provide 2–3 synonyms per language.`
      : ""
  }${
    cfg.includeNativeSynonyms && nativeLangName
      ? `
- Provide 2–3 synonyms of the source word "${text}" in ${nativeLangName} in the "nativeSynonyms" array.`
      : ""
  }${
    cfg.includeAlternatives
      ? `
- Provide exactly 2 alternative translations per language in the \`alternatives\` array. Each alternative should be a different valid translation with 1–2 synonyms.`
      : ""
  }${
    cfg.includeExamples
      ? `
- Provide exactly 3 example sentences per language. Keep each sentence SHORT — one sentence only.`
      : ""
  }${
    cfg.includeConnotationWarning
      ? `
- Warn about dangerous or misleading connotations ONLY if they exist. Most words should NOT have a warning. Omit the "connotationWarning" field entirely if the word has no dangerous connotations.${
          nativeLangName
            ? ` When present, every "connotationWarning" value in every target language block MUST be written in ${nativeLangName}, not in the target language. For example, if the user native language is ${nativeLangName}, translations.cs.connotationWarning and translations.en.connotationWarning are both written in ${nativeLangName}.`
            : ""
        }`
      : ""
  }
${
  cfg.includeTranscription
    ? `
- Transcription: provide IPA for non-Latin scripts (e.g. Russian: [prʲɪˈvʲet], Chinese: [tɕʰýntsɯ̀]). Keep it SHORT — one bracketed transcription only, never repeat. Optional for Latin scripts.`
    : ""
}
- Return ONLY the JSON object. No additional text before or after.${
    cfg.includeEquivalentNote
      ? `

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
  when a functional equivalent exists.`
      : ""
  }`;
}

/**
 * Builds a stricter retry prompt when the first attempt failed validation.
 *
 * Includes explicit error feedback so the AI can correct its output.
 */
export function buildStrictPrompt(request: TranslationRequest, errors: string[]): string {
  const base = buildTranslationPrompt(request);
  const cfg = resolveConfig(request.outputConfig);
  const nativeLangName = request.nativeLang ? getLanguageName(request.nativeLang) : null;

  const errorFeedback = errors.map((e) => `  - ${e}`).join("\n");

  const checkItems: string[] = [];
  if (cfg.includeExamples) {
    checkItems.push(
      "- Each of the 3 examples uses a DIFFERENT word: example 1 uses the main translation, example 2 uses an alternative/synonym, example 3 uses another alternative/synonym — in target sentences",
    );
    if (request.nativeLang) {
      checkItems.push("- Each example includes a native translation of the target sentence");
    }
  }
  checkItems.push("- Translations are actual translations, not the original word repeated");
  checkItems.push("- All required fields are present");
  if (cfg.includeEquivalentNote) {
    checkItems.push(`- For idiomatic expressions, set expressionType to "idiomatic_equivalent" with an equivalentNote`);
  }
  if (cfg.includeConnotationWarning) {
    checkItems.push(
      nativeLangName
        ? `- connotationWarning is present ONLY for words with genuinely dangerous/misleading meanings, and every connotationWarning in every target language block is written in ${nativeLangName}`
        : "- connotationWarning is present ONLY for words with genuinely dangerous/misleading meanings — omit for most words",
    );
  }

  return `${base}

IMPORTANT: Your previous response had validation errors:
${errorFeedback}

Please fix these issues and return a corrected JSON response.
Double-check that:
${checkItems.join("\n")}`;
}

function buildTopicHint(topic: string, isSentence: boolean, config: Required<TranslationOutputConfig>): string {
  const unit = isSentence ? "sentence" : "word";
  const lines = [
    "",
    "IMPORTANT - User Context Hint:",
    `The ${unit} should be understood in this context: "${topic}".`,
    "The context hint is metadata for sense selection; do not translate it as part of the input.",
    "Choose the meaning that best fits this context.",
  ];

  if (isSentence) {
    lines.push(
      "The translated sentence must preserve the intended situation, domain, register, and wording implied by this context.",
    );
  } else {
    const contextualFields = ["main translation"];
    if (config.includeAlternatives) contextualFields.push("alternatives");
    if (config.includeSynonyms) contextualFields.push("synonyms");
    if (config.includeExamples) contextualFields.push("examples");

    lines.push(
      `The requested fields (${contextualFields.join(", ")}) must all fit this context.`,
      "If dictionary definitions include multiple possible meanings, select the sense that best matches the user context.",
    );
  }

  return `\n${lines.join("\n")}`;
}

/**
 * Builds a dictionary context hint block for the AI prompt.
 *
 * Inserts Wiktionary offline data (POS, glosses) to guide the AI
 * toward the correct sense of the word and improve translation quality.
 *
 * Placed before output instructions so the AI sees authoritative definitions
 * before forming its translation.
 */
function buildDictionaryHint(ctx: DictionaryContext, config: Required<TranslationOutputConfig>): string {
  const lines: string[] = [
    "",
    "IMPORTANT — Authoritative Dictionary Context (Wiktionary):",
    `Word: "${ctx.word}" (${getLanguageName(ctx.langCode)}), part of speech: ${ctx.pos}.`,
  ];

  if (ctx.glosses.length > 0) {
    const maxGlosses = config.includeAlternatives || config.includeExamples ? 5 : 2;
    const glossList = ctx.glosses
      .slice(0, maxGlosses)
      .map((g) => `"${g}"`)
      .join(", ");
    lines.push(`The verified meaning of this word is: ${glossList}.`);
    lines.push("Use these definitions as the PRIMARY basis for the main translation.");
    if (config.includeAlternatives || config.includeSynonyms) {
      lines.push("Alternatives and synonyms should reflect these meanings.");
    }
  }

  if (ctx.formTags && ctx.formTags.length > 0) {
    lines.push(`Form tags: ${ctx.formTags.join(", ")}.`);
  }

  if (ctx.pos === "phrase" || ctx.pos === "idiom") {
    lines.push("This is a fixed expression — translate the meaning, not word-by-word.");
  }

  return `\n${lines.join("\n")}`;
}

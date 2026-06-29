/**
 * Prompt Builder — constructs AI prompts for translation requests.
 *
 * Builds multi-language prompts that produce output matching
 * translationResultSchema exactly. Requests emoji, synonyms, and example sentences.
 */

import { getLanguageName } from "../i18n/language-registry.js";
import { buildLanguageTraitsHint } from "./language-traits.js";
import type { DictionaryContext, TranslationOutputConfig, TranslationRequest } from "./types.js";

/**
 * Resolve output config — all fields default to true when absent.
 * Ensures backward compatibility: undefined or {} produces full output.
 */
function resolveConfig(config?: TranslationOutputConfig): Required<TranslationOutputConfig> {
  return {
    includeExamples: config?.includeExamples !== false,
    includeSynonyms: config?.includeSynonyms !== false,
    includeAlternatives: config?.includeAlternatives !== false,
    includeEquivalentNote: config?.includeEquivalentNote !== false,
    includeUsageNote: config?.includeUsageNote !== false,
    includeConnotationWarning: config?.includeConnotationWarning !== false,
    includeNativeSynonyms: config?.includeNativeSynonyms !== false,
    includeGrammarBreakdown: config?.includeGrammarBreakdown === true,
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
  const negativeHint = request.negativeConstraints
    ? buildNegativeConstraintHint(request.negativeConstraints, isSentence)
    : "";

  const dictionaryHint = dictionaryContext ? buildDictionaryHint(dictionaryContext, cfg) : "";

  const sourceLangName = getLanguageName(sourceLang);
  const targetLangNames = targetLangs.map((l) => getLanguageName(l)).join(", ");
  const nativeLangName = nativeLang ? getLanguageName(nativeLang) : null;
  const includesSourceTarget = targetLangs.includes(sourceLang);
  const isNativeSource = nativeLang !== undefined && sourceLang === nativeLang;
  const isLearningSource = nativeLang !== undefined && sourceLang !== nativeLang;

  const intro = isSentence
    ? `Translate the following sentence from ${sourceLangName} to ${targetLangNames}:\n"${text}"`
    : `Translate "${text}" from ${sourceLangName} to ${targetLangNames}.`;

  const requestedFields = ["translation text"];
  if (cfg.includeSynonyms) requestedFields.push("2-3 close synonyms");
  if (cfg.includeAlternatives) requestedFields.push("exactly 2 alternative translations");
  if (cfg.includeExamples) {
    requestedFields.push(
      nativeLangName
        ? `exactly 3 short examples with native translations in ${nativeLangName} when the target differs from the native language`
        : "exactly 3 short examples",
    );
  }
  if (cfg.includeEquivalentNote) requestedFields.push("idiom/equivalent metadata only when needed");
  if (cfg.includeUsageNote && nativeLangName && !isSentence) {
    requestedFields.push(`usageNote: concise usage guidance written in ${nativeLangName}`);
  }
  if (cfg.includeConnotationWarning) {
    requestedFields.push(
      nativeLangName
        ? `target-side connotation note written in ${nativeLangName} only when relevant`
        : "target-side connotation note only when relevant",
    );
  }
  if (nativeLangName) requestedFields.push(`nativeMeaning: a concise meaning/explanation in ${nativeLangName}`);
  if (cfg.includeNativeSynonyms && nativeLangName) requestedFields.push(`2-3 source synonyms in ${nativeLangName}`);
  if (isLearningSource && !isSentence) {
    requestedFields.push(
      `sourceUsage: usage guidance for "${text}" with explanation in ${nativeLangName ?? "the user's native language"}`,
    );
  }
  if (cfg.includeGrammarBreakdown) {
    requestedFields.push("grammarBreakdown: 2-3 constructional grammar patterns");
  }

  return `${intro}${topicHint}${negativeHint}${dictionaryHint}

Return ONLY valid JSON matching the provided schema. No markdown, no explanation, no code fences.
For each target language (${targetLangs.join(", ")}), provide: ${requestedFields.join("; ")}.
Also include one relevant emoji.
Prefer ONE natural, accurate main translation. Do not invent extra nuance in the main translation.

Rules:
- Include all grammatically essential markers that a learner needs to use the translated word correctly — such as articles, grammatical gender, verb aspect, or other conventions specific to each target language.${buildLanguageTraitsHint(targetLangs)}${
    nativeLangName
      ? `
- Include top-level "nativeMeaning" written in ${nativeLangName}. It must explain the original expression's meaning naturally in the user's native language, independent of the target-language translation blocks.`
      : ""
  }${
    includesSourceTarget
      ? `
- The source language (${sourceLang}) must not be returned as a translation block. If it is present in the required JSON schema, do not echo "${text}" as its "text" value; return a natural same-language paraphrase or concise explanation instead.`
      : ""
  }${
    isLearningSource
      ? `
- The user is translating from a learning language. Do not repeat the original input "${text}" as a displayed translation. Translate into ALL target languages, including the user's native language (${nativeLangName ?? nativeLang}). Provide a natural, accurate main translation for each target language — the native-language translation must be the direct word in the user's native language, not a description. Use "nativeMeaning" for a concise native-language summary and "sourceUsage" for source-language usage guidance.
- For the native-language target block (${nativeLang ?? ""}) ONLY: provide just "text" (the direct native translation word) and "synonyms" (2-3 native synonyms). OMIT "examples", "alternatives", "usageNote", and "connotationWarning" for the native target block — the source-language examples with native translations in "sourceUsage" already demonstrate usage, and the user already knows their native language.${
          isSentence
            ? ""
            : `
- Include top-level "sourceUsage" for the source word "${text}":
  * "explanation": written in ${nativeLangName ?? "the user's native language"}; explain the meaning, nuance, register, and when a learner should use or avoid this word.
  * "synonyms": 2-3 close synonyms in ${sourceLangName}, not translations into another language.
  * "examples": exactly 3 short ${sourceLangName} sentences using "${text}" or its normal inflected form in realistic contexts.${nativeLangName ? ` Each example MUST include "native": a natural ${nativeLangName} translation.` : ""}
  * Prefer collocations or lexical chunks that show how the word naturally combines with other words.`
        }`
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
- Except for the ${nativeLangName} target block itself, each example MUST include "native": a natural translation of the target example sentence into ${nativeLangName}. Do not force a literal back-translation.`
      : ""
  }`
      : ""
  }${
    cfg.includeExamples && nativeLang
      ? `
- For target language "${nativeLang}", omit the "native" field because the target sentence is already in the user's native language.
- For every other target language, "native" MUST be a natural ${nativeLangName ?? nativeLang} translation of the target example sentence.`
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
- Provide exactly 2 alternative translations per language in the \`alternatives\` array. Each alternative should be a different valid translation with 1–2 synonyms.
- If the source word has common materially different senses or parts of speech, use at least one alternative to represent another common sense. Example: for English "patient", the main translation may be the noun "patient", while an alternative should cover the adjective "patient" = "calm, able to wait".`
      : ""
  }${
    cfg.includeExamples
      ? `
- Provide exactly 3 example sentences per language. Keep each sentence SHORT — one sentence only.`
      : ""
  }${
    cfg.includeUsageNote && nativeLangName && !isSentence
      ? `
- Every target language block MUST include "usageNote" written in ${nativeLangName}. Explain ordinary nuance, register, natural usage, and important differences from nearby alternatives. This is regular learner guidance, not a warning.`
      : ""
  }${cfg.includeConnotationWarning ? buildConnotationRule(nativeLangName, isNativeSource, sourceLangName) : ""}
${
  cfg.includeGrammarBreakdown && nativeLangName
    ? `
- For each target language, include "grammarBreakdown": an array of 2-3 high-level grammatical CONSTRUCTIONS or PATTERNS used in the translation. NEVER list individual words with their parts of speech — that is NOT what this field is for.
  * Describe grammatical constructions: tense, mood, case usage, clause structure, word order patterns.
  * Grammar terms (e.g. Akkusativ, Konjunktiv II, Partizip II, Subjuntivo) must stay in the target language.
  * Explanations must be written in ${nativeLangName}.
  * Good examples: "auf + Akkusativ — направление движения", "hätte + Partizip II — Konjunktiv II, нереальное действие в прошлом", "Präsens — настоящее время для описания факта".
  * Bad examples (NEVER do this): "Er — подлежащее", "ist — глагол", "Schurke — существительное". This is a word-by-word breakdown and is strictly forbidden.`
    : ""
}
- Do not include pronunciation, IPA, romanization, or transliteration in any field.
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
      checkItems.push(
        `- Each example outside the ${nativeLangName ?? request.nativeLang} target block includes a native translation of the target sentence`,
      );
    }
  }
  if (request.nativeLang) {
    checkItems.push(`- Top-level nativeMeaning is present and written in ${nativeLangName ?? request.nativeLang}`);
  }
  if (cfg.includeUsageNote && request.nativeLang && request.inputType !== "sentence") {
    checkItems.push(
      `- Every target block has a usageNote written in ${nativeLangName ?? request.nativeLang}; usageNote is regular guidance, not a warning`,
    );
  }
  checkItems.push(
    "- No transcription, pronunciation, IPA, romanization, or bracketed sound-spelling fields are present",
  );
  if (request.nativeLang && request.sourceLang !== request.nativeLang) {
    checkItems.push("- Learning-language source input is not repeated as a same-language translation block");
    if (request.inputType !== "sentence") {
      checkItems.push(
        `- sourceUsage is present with a native-language usage explanation, source-language synonyms, and source-language examples for "${request.text}"`,
      );
    }
  }
  checkItems.push("- Translations are actual translations, not the original word repeated");
  checkItems.push("- All required fields are present");
  if (cfg.includeEquivalentNote) {
    checkItems.push(`- For idiomatic expressions, set expressionType to "idiomatic_equivalent" with an equivalentNote`);
  }
  if (cfg.includeConnotationWarning) {
    checkItems.push(buildConnotationCheck(nativeLangName, request.sourceLang === request.nativeLang));
  }
  if (cfg.includeGrammarBreakdown) {
    checkItems.push(
      "- Each target block has grammarBreakdown with 2-3 constructional grammar patterns, with grammar terms in the target language and explanations in the user's native language",
    );
  }

  return `${base}

IMPORTANT: Your previous response had validation errors:
${errorFeedback}

Please fix these issues and return a corrected JSON response.
Double-check that:
${checkItems.join("\n")}`;
}

/**
 * Builds a metadata-only prompt for the parallel metadata AI call.
 *
 * Asks only for emoji, nativeMeaning, sourceUsage, and nativeSynonyms —
 * no translations block. Used alongside per-language prompts that each
 * produce a single LanguageTranslation block.
 */
export function buildMetadataPrompt(request: TranslationRequest): string {
  const { text, sourceLang, targetLangs, nativeLang, topic, dictionaryContext, outputConfig, inputType } = request;
  const cfg = resolveConfig(outputConfig);
  const isSentence = inputType === "sentence";

  const topicHint = topic ? buildTopicHint(topic, isSentence, cfg) : "";
  const negativeHint = request.negativeConstraints
    ? buildNegativeConstraintHint(request.negativeConstraints, isSentence)
    : "";
  const dictionaryHint = dictionaryContext ? buildDictionaryHint(dictionaryContext, cfg) : "";

  const sourceLangName = getLanguageName(sourceLang);
  const targetLangNames = targetLangs.map((l) => getLanguageName(l)).join(", ");
  const nativeLangName = nativeLang ? getLanguageName(nativeLang) : null;
  const isLearningSource = nativeLang !== undefined && sourceLang !== nativeLang;

  const intro = isSentence
    ? `The user is translating the following sentence from ${sourceLangName} to ${targetLangNames}:\n"${text}"`
    : `The user is translating "${text}" from ${sourceLangName} to ${targetLangNames}.`;

  const requestedFields = ["one relevant emoji"];
  if (nativeLangName) requestedFields.push(`nativeMeaning: a concise meaning/explanation in ${nativeLangName}`);
  if (cfg.includeNativeSynonyms && nativeLangName) requestedFields.push(`2-3 source synonyms in ${nativeLangName}`);
  if (isLearningSource && !isSentence) {
    requestedFields.push(
      `sourceUsage: usage guidance for "${text}" with explanation in ${nativeLangName ?? "the user's native language"}`,
    );
  }

  return `${intro}${topicHint}${negativeHint}${dictionaryHint}

Return ONLY valid JSON matching the provided schema. No markdown, no explanation, no code fences.
Provide ONLY: ${requestedFields.join("; ")}.
Do NOT include any translations block.

Rules:${
    nativeLangName
      ? `
- Include top-level "nativeMeaning" written in ${nativeLangName}. It must explain the original expression's meaning naturally in the user's native language, independent of any target-language translations.`
      : ""
  }${
    isLearningSource && !isSentence
      ? `
- Include top-level "sourceUsage" for the source word "${text}":
  * "explanation": written in ${nativeLangName ?? "the user's native language"}; explain the meaning, nuance, register, and when a learner should use or avoid this word.
  * "synonyms": 2-3 close synonyms in ${sourceLangName}, not translations into another language.
  * "examples": exactly 3 short ${sourceLangName} sentences using "${text}" or its normal inflected form in realistic contexts.${nativeLangName ? ` Each example MUST include "native": a natural ${nativeLangName} translation.` : ""}
  * Prefer collocations or lexical chunks that show how the word naturally combines with other words.`
      : ""
  }${
    cfg.includeNativeSynonyms && nativeLangName
      ? `
- Provide 2–3 synonyms of the source word "${text}" in ${nativeLangName} in the "nativeSynonyms" array.`
      : ""
  }
- Do not include pronunciation, IPA, romanization, or transliteration in any field.
- Return ONLY the JSON object. No additional text before or after.`;
}

/**
 * Builds a single-language translation prompt for the parallel per-language AI call.
 *
 * Asks for a single LanguageTranslation block for one target language.
 * Does not request emoji, nativeMeaning, sourceUsage, or nativeSynonyms.
 */
export function buildSingleLanguagePrompt(request: TranslationRequest, targetLang: string): string {
  const singleLangRequest: TranslationRequest = {
    ...request,
    targetLangs: [targetLang],
  };
  const base = buildTranslationPrompt(singleLangRequest);
  return `${base}

IMPORTANT: Return ONLY the translation block for language "${targetLang}" as a flat JSON object. Do NOT wrap it in a "translations" key. Do NOT include emoji, nativeMeaning, sourceUsage, or nativeSynonyms.`;
}

/**
 * Builds a strict retry prompt for a single-language call after validation failure.
 */
export function buildSingleLanguageStrictPrompt(
  request: TranslationRequest,
  targetLang: string,
  errors: string[],
): string {
  const base = buildSingleLanguagePrompt(request, targetLang);
  const errorFeedback = errors.map((e) => `  - ${e}`).join("\n");
  return `${base}

IMPORTANT: Your previous response had validation errors:
${errorFeedback}

Please fix these issues and return a corrected JSON response.`;
}

/**
 * Builds a strict retry prompt for the metadata call after validation failure.
 */
export function buildMetadataStrictPrompt(request: TranslationRequest, errors: string[]): string {
  const base = buildMetadataPrompt(request);
  const errorFeedback = errors.map((e) => `  - ${e}`).join("\n");
  return `${base}

IMPORTANT: Your previous response had validation errors:
${errorFeedback}

Please fix these issues and return a corrected JSON response.`;
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

function buildNegativeConstraintHint(constraints: Record<string, string[]>, isSentence: boolean): string {
  const unit = isSentence ? "sentence" : "word";
  const lines = [
    "",
    "IMPORTANT - Alternative Translation Constraint:",
    `The user wants a DIFFERENT meaning/interpretation of this ${unit}. The following translations have already been shown and MUST NOT be repeated:`,
  ];
  for (const [lang, translations] of Object.entries(constraints)) {
    lines.push(`  ${lang.toUpperCase()}: ${translations.map((t) => `"${t}"`).join(", ")}`);
  }
  lines.push(
    "Choose a genuinely different sense, connotation, register, or interpretation.",
    "If no substantially different meaning exists, provide the closest alternative with different nuance.",
  );
  return `\n${lines.join("\n")}`;
}

function buildConnotationRule(nativeLangName: string | null, isNativeSource: boolean, sourceLangName: string): string {
  const languageRule = nativeLangName
    ? ` When present, every "connotationWarning" value in every target language block MUST be written in ${nativeLangName}, even inside non-${nativeLangName} target blocks, and it MUST describe the target translation in that block.`
    : "";
  const nativeSourceRule = isNativeSource
    ? `
- Because the source language is the user's native language (${sourceLangName}), NEVER use "connotationWarning" to explain the source word itself. Assume the user already knows the source-language nuance.`
    : "";

  return `
- Use "connotationWarning" as target-side metadata only: it must describe what the translated target word/expression implies in that target language, including nuance, usage context, register, or closest cultural/semantic connotation.
- Omit "connotationWarning" when the target translation has no noteworthy risky, misleading, offensive, or register-specific connotation.${languageRule}
- Decide "connotationWarning" independently for each target language. Do not copy the same source-language explanation across all target blocks.${nativeSourceRule}`;
}

function buildConnotationCheck(nativeLangName: string | null, isNativeSource: boolean): string {
  const languageClause = nativeLangName
    ? ` and written in ${nativeLangName}, not the target language, while still describing the target translation in that block`
    : "";
  const nativeSourceClause = isNativeSource ? ", never as an explanation of the native source word" : "";
  return `- connotationWarning is present only when the target translation has noteworthy connotations, is target-language specific${languageClause}${nativeSourceClause}`;
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

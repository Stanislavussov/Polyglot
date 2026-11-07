import { t } from "../i18n/i18n.js";
import { getLanguageName } from "../i18n/language-registry.js";
import type { SupportedLang } from "../i18n/types.js";
import type { TranslationAmbiguity, TranslationAmbiguityOptionKind } from "./types.js";

const TECHNICAL_PATTERN = /\b(sourceLang|targetLangs|JSON|schema|pipeline|validation|fieldPath)\b/i;

/** The "what is wrong" line of a clarification, shared by the bot and the web so both say the same thing. */
export function clarificationReasonText(ambiguity: TranslationAmbiguity, lang: SupportedLang): string {
  // The model's own explanation is already in the user's language; a leaked prompt term means it is not for users.
  const message = ambiguity.message?.trim();
  if (message && !TECHNICAL_PATTERN.test(message)) return message;

  const params = ambiguity.params ?? {};
  switch (ambiguity.reason) {
    case "source_language":
      return t("translationClarifyReasonLanguage", lang);
    case "word_sense":
    case "possible_typo":
      return t("translationClarifyReasonMeaning", lang);
    case "unrecognized_word":
      return t("translationClarifyReasonUnrecognized", lang, {
        word: params.word ?? "",
        lang: params.lang ? getLanguageName(params.lang, lang) : "",
      });
    default:
      return t("translationClarifyReasonFormat", lang);
  }
}

function userLanguageGroup(nativeLang: string, learningLangs: readonly string[]): string[] {
  return [nativeLang, ...learningLangs].filter((code, index, all) => all.indexOf(code) === index);
}

/** Targets once the user has picked the source language: their other languages, else the original targets. */
export function clarifiedTargetLangs(
  selectedSource: string,
  nativeLang: string,
  learningLangs: readonly string[],
  fallbackTargetLangs: readonly string[],
): string[] {
  const targets = userLanguageGroup(nativeLang, learningLangs).filter((code) => code !== selectedSource);
  return targets.length > 0 ? targets : [...fallbackTargetLangs];
}

/** The language is the question but the model offered no language: the user's own languages are the choice. */
export function fallbackLanguageChoices(
  ambiguity: TranslationAmbiguity,
  nativeLang: string,
  learningLangs: readonly string[],
): string[] {
  const offersLanguage = (ambiguity.options ?? []).some(
    (option) => option.kind === "source_language" && option.langCode,
  );
  return ambiguity.reason === "source_language" && !offersLanguage ? userLanguageGroup(nativeLang, learningLangs) : [];
}

export interface ClarificationView {
  message: string;
  options: {
    kind: TranslationAmbiguityOptionKind;
    label: string | null;
    value: string;
    langCode: string | null;
    correctedText: string | null;
  }[];
  languages: string[];
}

/**
 * A clarification as plain data for any channel (bot keyboard, web, a native app).
 * `label` is null where the channel words the button itself (translate as written).
 */
export function buildClarificationView(
  ambiguity: TranslationAmbiguity,
  lang: SupportedLang,
  nativeLang: string,
  learningLangs: readonly string[],
): ClarificationView {
  return {
    message: clarificationReasonText(ambiguity, lang),
    options: (ambiguity.options ?? []).map((option) => ({
      kind: option.kind ?? "meaning",
      label: option.kind === "translate_as_written" ? null : (option.label ?? option.value),
      value: option.value,
      langCode: option.langCode ?? null,
      correctedText: option.correctedText ?? null,
    })),
    languages: fallbackLanguageChoices(ambiguity, nativeLang, learningLangs),
  };
}

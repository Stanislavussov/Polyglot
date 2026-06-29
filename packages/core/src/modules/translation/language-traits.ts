/**
 * Per-language translation traits — static linguistic rules injected into the
 * per-language prompt so the model does not have to rediscover, every call, the
 * conventions a given target language needs (aspect pairs, articles, scripts, etc.).
 *
 * Injected one directive at a time (the service builds one prompt per target language),
 * so the prompt grows by ~1 line per requested target — kept tight for lite models.
 */

export interface LanguageTraits {
  /** ISO 639-1 code. */
  code: string;
  /**
   * Terse, prompt-ready directive for this language. ONE line, ≤ MAX_DIRECTIVE_LENGTH
   * chars — the comment above each entry holds the rationale (comments are not sent
   * to the model).
   */
  directive: string;
}

/** Upper bound for a single directive — guards the lite-model token budget. */
export const MAX_DIRECTIVE_LENGTH = 160;

export const LANGUAGE_TRAITS: Record<string, LanguageTraits> = {
  // Source/anchor and target: articles are lexical, phrasal verbs are units, idioms map to sense.
  en: {
    code: "en",
    directive: "Mark article (a/the); keep phrasal-verb particles intact; idioms → sense, not word-for-word.",
  },
  // Aspect splits one English verb into a pair; stress is phonemic but unwritten; no articles.
  ru: {
    code: "ru",
    directive:
      "Stress-mark the headword; verb lemma = aspect pair (impf/pf); ты/вы register; respect verb case-government; no articles.",
  },
  // Biggest quality axis: avoid russisms/surzhyk; vocative is alive; euphonic alternations.
  uk: {
    code: "uk",
    directive:
      "Vocative in address; AVOID russisms/surzhyk — use native collocations; apply в/у & і/й euphony; verb aspect pair.",
  },
  // Vowel length is phonemic (diacritics matter); standard vs common-Czech register choice.
  cs: {
    code: "cs",
    directive:
      "Keep diacritics (vowel length is phonemic); verb lemma = aspect pair; ty/vy; pick spisovná vs obecná by register; vocative in address.",
  },
  // Politeness uses 3rd-person Pan/Pani, not "wy"; masculine-personal gender drives plural agreement.
  pl: {
    code: "pl",
    directive:
      "Politeness via Pan/Pani + 3rd-person verb (not wy); apply masculine-personal plural agreement; keep ł/ż/ź/ć/ń/ś & nasals; vocative.",
  },
  // Gender is lexical → lemma needs its article; nouns capitalize; separable verbs split in use.
  de: {
    code: "de",
    directive:
      "Lemma = article+noun+plural (der/die/das …, -pl); capitalize nouns; split separable verbs in use; du/Sie; respect V2 order.",
  },
  // Notorious false friends; gender via article; subjunctive; participle/adjective agreement.
  fr: {
    code: "fr",
    directive:
      "Lemma with le/la; tu/vous; subjunctive after triggers; agree participle/adjective; watch false friends (actuellement, librairie, assister).",
  },
  // Region split (Spain/LatAm/voseo) drives pronouns and vocabulary; ser vs estar.
  es: {
    code: "es",
    directive:
      "State region (ES / LatAm / voseo) — drives pronoun & vocabulary; ser vs estar; vosotros = Spain only; por/para.",
  },
  // Phonological article choice; politeness via Lei (3rd person); geminates are phonemic.
  it: {
    code: "it",
    directive:
      "Use the correct article (il/lo/la/l'); politeness via Lei (3rd person); congiuntivo in writing; geminate consonants are phonemic.",
  },
  // pt-PT vs pt-BR is the dominant split: vocabulary, você/tu, clitic placement, gerund form.
  pt: {
    code: "pt",
    directive:
      "State variant (pt-PT / pt-BR) — drives vocabulary, você/tu, clitic placement, gerund vs 'a'+infinitive; ser vs estar.",
  },
  // Agglutinative Turkic: vowel-harmony suffixes; default Cyrillic script; avoid russisms.
  kk: {
    code: "kk",
    directive:
      "Cyrillic script; agglutinative SOV, postpositions, no gender/articles; vowel-harmony suffixes; literary Kazakh, avoid russisms; no plural after numerals.",
  },
};

export function getLanguageTraits(code: string): LanguageTraits | undefined {
  return LANGUAGE_TRAITS[code];
}

/**
 * Builds the per-language rules block for the requested target languages.
 * Returns "" when none of the codes have traits, so the prompt stays clean.
 */
export function buildLanguageTraitsHint(targetLangs: string[]): string {
  const lines = targetLangs
    .map((c) => getLanguageTraits(c))
    .filter((t): t is LanguageTraits => t !== undefined)
    .map((t) => `- ${t.code}: ${t.directive}`);
  return lines.length > 0 ? `\nLanguage-specific rules:\n${lines.join("\n")}` : "";
}

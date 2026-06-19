import type { ValidationError, ValidationResult } from "../types.js";

interface NativeExample {
  target?: unknown;
  native?: unknown;
}

interface TranslationFields {
  connotationWarning?: unknown;
  equivalentNote?: unknown;
  examples?: unknown;
  usageNote?: unknown;
}

const NOTE_FIELDS = ["connotationWarning", "equivalentNote", "usageNote"] as const;
const PRONUNCIATION_LABEL = /\b(?:ipa|pronunciation|phonetic|transcription|romanization|transliteration)\s*[:：]/iu;
const PRONUNCIATION_LABEL_CYRILLIC = /(?:транскрипц|произношен|фонетическ|романизац|транслитерац)[\p{L}]*\s*[:：]/iu;
const IPA_DELIMITED = /(?:\/|\[)[^\]/]*[\u0250-\u02af\u1d00-\u1dbfˈˌ][^\]/]*(?:\/|\])/u;

/**
 * Validate fields whose content must be written in the user's native language.
 *
 * This intentionally uses only high-confidence deterministic checks. It does not
 * attempt statistical language detection for short text.
 */
export function validateNativeFields(
  raw: Record<string, unknown>,
  translations: Record<string, Record<string, unknown>>,
  expectedLangs: string[],
  nativeLang: string,
): ValidationResult {
  const errors: ValidationError[] = [];

  validateForbiddenPronunciation(raw, "", errors);
  validateExpectedScript(raw.nativeMeaning, nativeLang, "nativeMeaning", errors);

  const sourceUsage = asRecord(raw.sourceUsage);
  if (sourceUsage) {
    validateExpectedScript(sourceUsage.explanation, nativeLang, "sourceUsage.explanation", errors);
    validateExamples(sourceUsage.examples, nativeLang, "sourceUsage.examples", errors);
  }

  for (const lang of expectedLangs) {
    const translation = translations[lang] as TranslationFields | undefined;
    if (!translation) continue;

    validateExpectedScript(
      translation.connotationWarning,
      nativeLang,
      `translations.${lang}.connotationWarning`,
      errors,
    );
    validateExpectedScript(translation.usageNote, nativeLang, `translations.${lang}.usageNote`, errors);

    const examples = Array.isArray(translation.examples) ? (translation.examples as NativeExample[]) : [];
    for (let index = 0; index < examples.length; index++) {
      const example = examples[index];
      if (!example || typeof example.native !== "string") continue;

      const field = `translations.${lang}.examples.${index}.native`;
      if (typeof example.target === "string" && sameText(example.target, example.native)) {
        errors.push({
          rule: "language",
          message: "Native example translation must not duplicate the target sentence",
          field,
        });
        continue;
      }

      validateExpectedScript(example.native, nativeLang, field, errors);
    }
  }

  validateDuplicateNotes(translations, expectedLangs, errors);

  return { valid: errors.length === 0, errors };
}

function validateForbiddenPronunciation(value: unknown, field: string, errors: ValidationError[]): void {
  if (typeof value === "string") {
    if (PRONUNCIATION_LABEL.test(value) || PRONUNCIATION_LABEL_CYRILLIC.test(value) || IPA_DELIMITED.test(value)) {
      errors.push({
        rule: "format",
        message: "Pronunciation, IPA, romanization, and transliteration are not allowed",
        field,
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      validateForbiddenPronunciation(value[index], appendField(field, String(index)), errors);
    }
    return;
  }

  const record = asRecord(value);
  if (!record) return;

  for (const [key, child] of Object.entries(record)) {
    validateForbiddenPronunciation(child, appendField(field, key), errors);
  }
}

function validateDuplicateNotes(
  translations: Record<string, Record<string, unknown>>,
  expectedLangs: string[],
  errors: ValidationError[],
): void {
  for (const noteField of NOTE_FIELDS) {
    const seen = new Set<string>();

    for (const lang of expectedLangs) {
      const value = (translations[lang] as TranslationFields | undefined)?.[noteField];
      if (typeof value !== "string" || value.trim().length === 0) continue;

      const normalized = normalizeText(value);
      if (seen.has(normalized)) {
        errors.push({
          rule: "duplication",
          message: `The ${noteField} note must be specific to the "${lang}" translation block`,
          field: `translations.${lang}.${noteField}`,
        });
        continue;
      }

      seen.add(normalized);
    }
  }
}

function validateExamples(value: unknown, nativeLang: string, fieldPrefix: string, errors: ValidationError[]): void {
  if (!Array.isArray(value)) return;

  for (let index = 0; index < value.length; index++) {
    const example = asRecord(value[index]);
    if (!example) continue;
    validateExpectedScript(example.native, nativeLang, `${fieldPrefix}.${index}.native`, errors);
  }
}

function validateExpectedScript(value: unknown, nativeLang: string, field: string, errors: ValidationError[]): void {
  if (typeof value !== "string" || value.trim().length === 0) return;
  if (nativeLang !== "ru" || hasSufficientCyrillic(value)) return;

  errors.push({
    rule: "language",
    message: "Expected Russian text in Cyrillic; received Latin text or romanization",
    field,
  });
}

function hasSufficientCyrillic(value: string): boolean {
  const cyrillicCount = value.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  const latinCount = value.match(/\p{Script=Latin}/gu)?.length ?? 0;
  const relevantLetters = cyrillicCount + latinCount;

  if (relevantLetters === 0) return true;
  return cyrillicCount >= 2 && cyrillicCount / relevantLetters >= 0.5;
}

function sameText(left: string, right: string): boolean {
  return normalizeText(left) === normalizeText(right);
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function appendField(parent: string, child: string): string {
  return parent.length > 0 ? `${parent}.${child}` : child;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

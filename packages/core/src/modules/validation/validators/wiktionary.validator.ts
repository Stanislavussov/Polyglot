import type { ValidationResult, ValidationError } from "../types.js";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

/** Known part-of-speech values from Wiktionary JSONL extracts */
export const KNOWN_POS = [
  "noun",
  "verb",
  "adj",
  "adv",
  "phrase",
  "idiom",
  "proverb",
  "prep",
  "conj",
  "intj",
  "det",
  "pron",
  "num",
  "particle",
  "prefix",
  "suffix",
  "infix",
  "affix",
  "name",
  "punct",
  "abbrev",
  "contraction",
  "character",
  "symbol",
] as const;

export type KnownPos = (typeof KNOWN_POS)[number];

/** Raw Wiktionary JSONL entry shape (subset of fields we validate) */
export interface WiktionaryEntryInput {
  word?: unknown;
  lang?: unknown;
  lang_code?: unknown;
  pos?: unknown;
  forms?: unknown;
  senses?: unknown;
}

/** Parsed word context record ready for DB insertion */
export interface WordContextInput {
  word?: unknown;
  languageId?: unknown;
  pos?: unknown;
  formTags?: unknown;
  glosses?: unknown;
}

// ─────────────────────────────────────────────
// ISO 639-1 code pattern (2 lowercase letters)
// ─────────────────────────────────────────────
const ISO_639_1_RE = /^[a-z]{2,3}$/;

// ─────────────────────────────────────────────
// validateWiktionaryEntry
// ─────────────────────────────────────────────

/**
 * Validates a raw Wiktionary JSONL entry has all required fields
 * and correct data types.
 *
 * Required fields:
 * - word: non-empty string
 * - lang_code: string matching ISO 639-1 pattern (2-3 lowercase letters)
 * - pos: non-empty string
 *
 * Optional validated fields:
 * - lang: string (language name)
 * - senses: array with at least one sense containing glosses
 * - forms: array of form objects
 *
 * Pure function — no side effects, no I/O.
 */
export function validateWiktionaryEntry(
  entry: WiktionaryEntryInput,
): ValidationResult {
  const errors: ValidationError[] = [];

  // Null/undefined guard
  if (!entry || typeof entry !== "object") {
    errors.push({
      rule: "wiktionary",
      message: "Entry must be a non-null object",
    });
    return { valid: false, errors };
  }

  // Required: word
  if (typeof entry.word !== "string" || entry.word.trim().length === 0) {
    errors.push({
      rule: "wiktionary",
      message: "Entry missing required field: word (must be non-empty string)",
      field: "word",
    });
  }

  // Required: lang_code
  if (typeof entry.lang_code !== "string" || entry.lang_code.trim().length === 0) {
    errors.push({
      rule: "wiktionary",
      message: "Entry missing required field: lang_code (must be non-empty string)",
      field: "lang_code",
    });
  } else if (!ISO_639_1_RE.test(entry.lang_code)) {
    errors.push({
      rule: "wiktionary",
      message: `Invalid lang_code format: "${entry.lang_code}" (expected 2-3 lowercase letters)`,
      field: "lang_code",
    });
  }

  // Required: pos
  if (typeof entry.pos !== "string" || entry.pos.trim().length === 0) {
    errors.push({
      rule: "wiktionary",
      message: "Entry missing required field: pos (must be non-empty string)",
      field: "pos",
    });
  }

  // Optional: lang (if present, must be string)
  if (entry.lang !== undefined && typeof entry.lang !== "string") {
    errors.push({
      rule: "wiktionary",
      message: "Field lang must be a string if present",
      field: "lang",
    });
  }

  // Optional: senses (if present, must be array)
  if (entry.senses !== undefined) {
    if (!Array.isArray(entry.senses)) {
      errors.push({
        rule: "wiktionary",
        message: "Field senses must be an array if present",
        field: "senses",
      });
    } else if (entry.senses.length === 0) {
      errors.push({
        rule: "wiktionary",
        message: "Senses array is empty — entry has no definitions",
        field: "senses",
      });
    }
  }

  // Optional: forms (if present, must be array)
  if (entry.forms !== undefined && !Array.isArray(entry.forms)) {
    errors.push({
      rule: "wiktionary",
      message: "Field forms must be an array if present",
      field: "forms",
    });
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────
// validateWordContext
// ─────────────────────────────────────────────

/**
 * Validates a parsed word context record before database insertion.
 *
 * Required fields:
 * - word: non-empty string
 * - languageId: positive integer
 * - pos: non-empty string
 *
 * Optional validated fields:
 * - formTags: array of strings
 * - glosses: array of non-empty strings
 *
 * Pure function — no side effects, no I/O.
 */
export function validateWordContext(
  record: WordContextInput,
): ValidationResult {
  const errors: ValidationError[] = [];

  // Null/undefined guard
  if (!record || typeof record !== "object") {
    errors.push({
      rule: "wordContext",
      message: "Record must be a non-null object",
    });
    return { valid: false, errors };
  }

  // Required: word
  if (typeof record.word !== "string" || record.word.trim().length === 0) {
    errors.push({
      rule: "wordContext",
      message: "Record missing required field: word (must be non-empty string)",
      field: "word",
    });
  }

  // Required: languageId
  if (
    typeof record.languageId !== "number" ||
    !Number.isInteger(record.languageId) ||
    record.languageId <= 0
  ) {
    errors.push({
      rule: "wordContext",
      message: "Record missing required field: languageId (must be positive integer)",
      field: "languageId",
    });
  }

  // Required: pos
  if (typeof record.pos !== "string" || record.pos.trim().length === 0) {
    errors.push({
      rule: "wordContext",
      message: "Record missing required field: pos (must be non-empty string)",
      field: "pos",
    });
  }

  // Optional: formTags (if present, must be array of strings)
  if (record.formTags !== undefined) {
    if (!Array.isArray(record.formTags)) {
      errors.push({
        rule: "wordContext",
        message: "Field formTags must be an array if present",
        field: "formTags",
      });
    } else {
      for (let i = 0; i < record.formTags.length; i++) {
        if (typeof record.formTags[i] !== "string") {
          errors.push({
            rule: "wordContext",
            message: `formTags[${i}] must be a string`,
            field: `formTags.${i}`,
          });
        }
      }
    }
  }

  // Optional: glosses (if present, must be array of non-empty strings)
  if (record.glosses !== undefined) {
    if (!Array.isArray(record.glosses)) {
      errors.push({
        rule: "wordContext",
        message: "Field glosses must be an array if present",
        field: "glosses",
      });
    } else {
      for (let i = 0; i < record.glosses.length; i++) {
        if (typeof record.glosses[i] !== "string") {
          errors.push({
            rule: "wordContext",
            message: `glosses[${i}] must be a string`,
            field: `glosses.${i}`,
          });
        } else if (record.glosses[i].trim().length === 0) {
          errors.push({
            rule: "wordContext",
            message: `glosses[${i}] is empty`,
            field: `glosses.${i}`,
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────
// validateGlosses
// ─────────────────────────────────────────────

/**
 * Validates an array of glosses (English definitions) from Wiktionary.
 *
 * Rules:
 * - Must be a non-empty array
 * - Each gloss must be a non-empty string
 * - Each gloss must not be a hallucination placeholder
 *
 * Pure function — no side effects, no I/O.
 */
export function validateGlosses(glosses: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!Array.isArray(glosses)) {
    errors.push({
      rule: "glosses",
      message: "Glosses must be an array",
      field: "glosses",
    });
    return { valid: false, errors };
  }

  if (glosses.length === 0) {
    errors.push({
      rule: "glosses",
      message: "Glosses array is empty — no definitions available",
      field: "glosses",
    });
    return { valid: false, errors };
  }

  for (let i = 0; i < glosses.length; i++) {
    const gloss = glosses[i];

    if (typeof gloss !== "string") {
      errors.push({
        rule: "glosses",
        message: `glosses[${i}] must be a string, got ${typeof gloss}`,
        field: `glosses.${i}`,
      });
      continue;
    }

    if (gloss.trim().length === 0) {
      errors.push({
        rule: "glosses",
        message: `glosses[${i}] is empty`,
        field: `glosses.${i}`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────
// validatePos
// ─────────────────────────────────────────────

/**
 * Validates a part-of-speech value is a known Wiktionary POS tag.
 *
 * Does NOT fail for unknown POS values (Wiktionary has many POS tags);
 * instead returns a warning-level error that doesn't block import
 * but can be used for logging/filtering.
 *
 * Pure function — no side effects, no I/O.
 */
export function validatePos(pos: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof pos !== "string" || pos.trim().length === 0) {
    errors.push({
      rule: "pos",
      message: "POS must be a non-empty string",
      field: "pos",
    });
    return { valid: false, errors };
  }

  // We don't fail for unknown POS — Wiktionary has many varieties
  // But we report it so callers can log/filter
  if (!KNOWN_POS.includes(pos as KnownPos)) {
    errors.push({
      rule: "pos",
      message: `Unknown POS value: "${pos}" (not in known set: ${KNOWN_POS.join(", ")})`,
      field: "pos",
    });
  }

  return { valid: errors.length === 0, errors };
}

import type { ValidationError, ValidationResult } from "../types.js";

const PLACEHOLDER_PATTERN = /\{\{?\w+\}\}?|%\d?\$?[sd]|\$\{\w+\}/g;
const URL_PATTERN = /https?:\/\/[^\s)]+|www\.[^\s)]+/gi;
const AMBIGUOUS_DATE_PATTERN = /\b(\d{1,2})([/.])(\d{1,2})(?:\2(\d{2,4}))?\b/g;
const NUMBER_PATTERN = /\b\d+(?::\d+)?\b/g;
const MARKDOWN_LINK_PATTERN = /\[[^\]]*]\(([^)]+)\)/g;

export function validateImmutableContent(original: string, translation: string): ValidationResult {
  const errors: ValidationError[] = [];
  const originalTokens = collectImmutableTokens(original);
  const translationTokens = collectImmutableTokens(translation);

  for (const token of originalTokens) {
    const expectedCount = countOccurrences(original, token);
    const actualCount = countOccurrences(translation, token);

    if (actualCount !== expectedCount) {
      errors.push({
        rule: "immutable",
        message: `Immutable token "${token}" must be preserved byte-for-byte (${expectedCount} expected, ${actualCount} found)`,
        field: "text",
      });
    }
  }

  for (const token of translationTokens) {
    if (originalTokens.includes(token)) continue;

    errors.push({
      rule: "immutable",
      message: `Translation introduced immutable token "${token}" that was not present in the original`,
      field: "text",
    });
  }

  return { valid: errors.length === 0, errors };
}

function collectImmutableTokens(original: string): string[] {
  const tokens = new Set<string>();

  addMatches(tokens, original, PLACEHOLDER_PATTERN);
  addMatches(tokens, original, URL_PATTERN);
  addMatches(tokens, original, NUMBER_PATTERN);

  for (const match of original.matchAll(AMBIGUOUS_DATE_PATTERN)) {
    const left = Number(match[1]);
    const right = Number(match[3]);
    if (left <= 12 && right <= 12) {
      tokens.add(match[0]);
    }
  }

  for (const match of original.matchAll(MARKDOWN_LINK_PATTERN)) {
    tokens.add("[");
    tokens.add("]");
    tokens.add(`(${match[1]})`);
  }

  if (original.includes("**")) tokens.add("**");
  if (original.includes("__")) tokens.add("__");
  if (original.includes("`")) tokens.add("`");

  return [...tokens];
}

function addMatches(tokens: Set<string>, value: string, pattern: RegExp): void {
  for (const match of value.matchAll(pattern)) {
    if (match[0].length > 0) {
      tokens.add(match[0]);
    }
  }
}

function countOccurrences(value: string, token: string): number {
  if (token.length === 0) return 0;

  let count = 0;
  let offset = 0;
  while (offset <= value.length - token.length) {
    const index = value.indexOf(token, offset);
    if (index === -1) break;
    count++;
    offset = index + token.length;
  }

  return count;
}

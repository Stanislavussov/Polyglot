/**
 * Text input validation — filters out non-translatable content.
 *
 * Detects emoji-only messages, sticker-like unicode art, and other
 * inputs that cannot be meaningfully translated by the AI pipeline.
 *
 * Pure, stateless validation — no I/O, no side effects.
 */

/**
 * Regex matching emoji-related Unicode characters:
 * - \p{Extended_Pictographic} — base emoji characters (😀, ⭐, 🏠, etc.)
 * - \p{Emoji_Modifier}       — skin tone modifiers (🏻–🏿)
 * - \u{FE0F}                 — emoji presentation selector
 * - \u{FE0E}                 — text presentation selector
 * - \u{200D}                 — zero-width joiner (for composite emoji like 👨‍👩‍👧)
 * - \u{20E3}                 — combining enclosing keycap (1️⃣)
 * - \u{1F1E6}–\u{1F1FF}     — regional indicator symbols (flags 🇺🇸)
 */
const EMOJI_PATTERN =
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: <fix>
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu;

export const MAX_TRANSLATE_INPUT_LENGTH = 500;

export type TranslateInputValidationReason = "empty" | "emoji" | "command" | "digits" | "tooLong";

export interface TranslateInputValidationResult {
  valid: boolean;
  reason?: TranslateInputValidationReason;
}

/**
 * Check whether a text message consists entirely of emoji characters
 * (with optional whitespace). Such messages cannot be translated.
 *
 * Examples:
 * - "😀"        → true
 * - "🇺🇸🇬🇧"    → true
 * - "👨‍👩‍👧"   → true
 * - "😀 hello"  → false
 * - "hello"     → false
 * - ""          → false (empty is not emoji-only)
 */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  const stripped = trimmed.replace(EMOJI_PATTERN, "").replace(/\s+/g, "");
  return stripped.length === 0;
}

export function validateTranslatableText(text: string): TranslateInputValidationResult {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: "empty" };
  }

  if (trimmed.length > MAX_TRANSLATE_INPUT_LENGTH) {
    return { valid: false, reason: "tooLong" };
  }

  if (isEmojiOnly(trimmed)) {
    return { valid: false, reason: "emoji" };
  }

  if (/^\/\S+/.test(trimmed)) {
    return { valid: false, reason: "command" };
  }

  if (/^[\d\s.,:;+\-*/=()]+$/.test(trimmed) && /\d/.test(trimmed)) {
    return { valid: false, reason: "digits" };
  }

  return { valid: true };
}

/**
 * Check whether a Telegram message contains non-text content.
 * Returns the type of non-text content detected, or null if it's a text message.
 *
 * Checks for: sticker, animation (GIF), photo, voice, video, video_note,
 * audio, document, location, contact, venue, poll, dice.
 */
export type NonTextType =
  | "sticker"
  | "animation"
  | "photo"
  | "voice"
  | "video"
  | "video_note"
  | "audio"
  | "document"
  | "location"
  | "contact"
  | "venue"
  | "poll"
  | "dice";

const NON_TEXT_FIELDS: NonTextType[] = [
  "sticker",
  "animation",
  "photo",
  "voice",
  "video",
  "video_note",
  "audio",
  "document",
  "location",
  "contact",
  "venue",
  "poll",
  "dice",
];

/**
 * Detect the type of non-text content in a message object.
 * Returns the first non-text type found, or null if the message is text-only.
 */
export function detectNonTextContent(message: Record<string, unknown>): NonTextType | null {
  for (const field of NON_TEXT_FIELDS) {
    if (message[field]) {
      return field;
    }
  }
  return null;
}

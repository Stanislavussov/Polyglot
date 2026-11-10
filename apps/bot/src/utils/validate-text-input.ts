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

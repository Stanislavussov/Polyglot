/**
 * Turns a raw Telegram update into the flat set of fields we log for it.
 *
 * This is the "what did the user actually do" half of reproduction: which
 * button was tapped (`callbackData` is the verbatim payload, e.g.
 * `dict:view:1234`), which command was typed, what text was sent, or which
 * non-text attachment arrived. Combined with the trace id stamped by the
 * logger, one Loki query replays a session tap by tap.
 */
import type { Context } from "grammy";
import type { Update } from "grammy/types";
import { detectNonTextContent } from "../utils/validate-text-input.js";

/**
 * A type alias rather than an interface so it satisfies `EventFields`
 * (`Record<string, unknown>`) and can be spread straight into an event.
 */
export type UpdateDescriptor = {
  /** Telegram's own update kind: message, callback_query, my_chat_member, … */
  updateType: string;
  /** Bot command without arguments, e.g. `/dictionary`. */
  command?: string;
  /** Verbatim callback payload of an inline-button tap. */
  callbackData?: string;
  /** First segment of the callback payload — the natural Grafana grouping key. */
  callbackFamily?: string;
  /** Full message text. Kept unredacted so a failing input is reproducible. */
  text?: string;
  textLength?: number;
  /** Attachment kind for non-text messages (photo, voice, sticker, …). */
  contentType?: string;
  messageId?: number;
  chatType?: string;
  /** Telegram client locale — explains language defaults chosen for new users. */
  languageCode?: string;
};

/**
 * Telegram sends exactly one payload key besides `update_id`, so reading the key
 * itself classifies the update. Deriving it instead of matching a hand-written
 * list means update kinds we do not handle yet still get logged by their real
 * name rather than as "other".
 */
function updateType(update: Update | undefined): string {
  if (!update) return "unknown";
  const key = Object.keys(update).find((k) => k !== "update_id");
  return key ?? "unknown";
}

export function describeUpdate(ctx: Context): UpdateDescriptor {
  const message = ctx.message ?? ctx.editedMessage;
  const text = message?.text;
  const callbackData = ctx.callbackQuery?.data;
  const contentType = message ? detectNonTextContent(message as unknown as Record<string, unknown>) : null;

  return {
    updateType: updateType(ctx.update),
    ...(text?.startsWith("/") && { command: text.split(/\s+/)[0] }),
    ...(callbackData !== undefined && {
      callbackData,
      callbackFamily: callbackData.split(":")[0],
    }),
    ...(text !== undefined && { text, textLength: text.length }),
    ...(contentType !== null && { contentType }),
    ...(message?.message_id !== undefined && { messageId: message.message_id }),
    ...(ctx.chat?.type !== undefined && { chatType: ctx.chat.type }),
    ...(ctx.from?.language_code !== undefined && { languageCode: ctx.from.language_code }),
  };
}

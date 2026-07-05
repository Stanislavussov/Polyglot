/**
 * Shared inline-keyboard edit helpers.
 *
 * Telegram forbids a bot from editing a message that is older than 48 hours (or
 * one that was deleted): `api.editMessageText` then rejects with
 * `400: Bad Request: message to edit not found` (or `message can't be edited`).
 * Every callback handler that answers by editing its own message in place would
 * otherwise silently die on such old messages — the button just looks dead.
 *
 * These helpers centralise the fallback: when the in-place edit is impossible,
 * re-send the SAME rendered text + keyboard as a NEW message so the feature
 * keeps working (all affected families are fully restorable from a fresh
 * message). A benign "message is not modified" rejection stays a silent no-op.
 */
import { GrammyError } from "grammy";
import type { BotContext, ConversationContext } from "../../types.js";

/**
 * Either the outer bot context or a conversation replay context. Both expose
 * the identical grammy `editMessageText` / `editMessageReplyMarkup` / `reply`
 * methods (they derive from the same base `Context`), so the helpers work with
 * whichever a given call site holds.
 */
type EditableContext = BotContext | ConversationContext;

/**
 * Options accepted by BOTH `editMessageText` and `reply` for the fields these
 * helpers actually forward (`reply_markup`, `parse_mode`, `link_preview_options`).
 * Derived from grammy's `editMessageText` signature — the narrower of the two —
 * so it can never drift from the real API and stays assignable to `reply` too.
 */
type EditOrReplyOptions = NonNullable<Parameters<BotContext["editMessageText"]>[1]>;

/** Options accepted by `editMessageReplyMarkup` (reply_markup only). */
type ReplyMarkupOptions = NonNullable<Parameters<BotContext["editMessageReplyMarkup"]>[0]>;

/**
 * The message is gone or too old to edit — Telegram answers 400 with one of
 * these descriptions. The in-place edit can't succeed; callers fall back to a
 * fresh message.
 */
function isEditImpossible(err: unknown): boolean {
  if (!(err instanceof GrammyError)) return false;
  const description = err.description.toLowerCase();
  return description.includes("message to edit not found") || description.includes("message can't be edited");
}

/**
 * A no-op edit (identical text + markup). Telegram rejects it, but it is
 * harmless and expected — swallow it silently.
 */
function isMessageNotModified(err: unknown): boolean {
  return err instanceof GrammyError && err.description.toLowerCase().includes("message is not modified");
}

/**
 * Edit the callback message's text in place; if the message is too old / deleted
 * to edit, send the same text + keyboard as a fresh message instead. A benign
 * "message is not modified" error is swallowed. Any other error is rethrown so
 * the global bot-error handler can see genuine failures.
 */
export async function editMessageTextOrReply(
  ctx: EditableContext,
  text: string,
  options?: EditOrReplyOptions,
): Promise<void> {
  try {
    await ctx.editMessageText(text, options);
  } catch (err) {
    if (isMessageNotModified(err)) return;
    if (isEditImpossible(err)) {
      await ctx.reply(text, options);
      return;
    }
    throw err;
  }
}

/**
 * Edit only the callback message's inline keyboard; if the message is too old /
 * deleted to edit, silently ignore it — there is no text to re-send and a stale
 * keyboard-disable is purely cosmetic. Swallows "message is not modified"; any
 * other error is rethrown.
 */
export async function editMessageReplyMarkupOrIgnore(
  ctx: EditableContext,
  options?: ReplyMarkupOptions,
): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup(options);
  } catch (err) {
    if (isMessageNotModified(err)) return;
    if (isEditImpossible(err)) return;
    throw err;
  }
}

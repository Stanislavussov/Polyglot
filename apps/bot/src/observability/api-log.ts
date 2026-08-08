/**
 * Logs every outgoing Telegram API call.
 *
 * This is the other half of reproduction: `update.received` says what the user
 * did, these records say what the bot actually sent back and whether Telegram
 * accepted it. Several past incidents were only visible here — editing a
 * message older than 48h ("message to edit not found"), flood-limit backoff,
 * and replies that silently failed while the user saw a spinner.
 *
 * Installed as a grammY API transformer, so it covers every call made through
 * `bot.api` — handler replies, keyboard edits, and the notification
 * scheduler's batch sends alike.
 */
import { errorFields, logEvent } from "@polyglot/core";
import type { Transformer } from "grammy";

/** Payload fields worth logging by name; the rest would be noise or huge. */
interface CallPayload {
  chat_id?: number | string;
  message_id?: number;
  text?: string;
  caption?: string;
  callback_query_id?: string;
}

function describeCall(payload: unknown): Record<string, unknown> {
  const p = (payload ?? {}) as CallPayload;
  const body = p.text ?? p.caption;
  return {
    ...(p.chat_id !== undefined && { chatId: p.chat_id }),
    ...(p.message_id !== undefined && { messageId: p.message_id }),
    ...(body !== undefined && { outgoingLength: body.length }),
  };
}

/**
 * The rendered message body the user saw. Logged separately at debug level:
 * it is exactly what you want when a card renders wrong, and far too voluminous
 * to keep at info for every send.
 */
function logOutgoingBody(method: string, payload: unknown): void {
  const p = (payload ?? {}) as CallPayload;
  const body = p.text ?? p.caption;
  if (body === undefined) return;
  logEvent("telegram.api.body", { method, chatId: p.chat_id, body }, "debug");
}

export function createApiLogTransformer(): Transformer {
  return async (prev, method, payload, signal) => {
    const startedAt = Date.now();
    const call = describeCall(payload);
    logOutgoingBody(method, payload);

    try {
      const result = await prev(method, payload, signal);
      logEvent("telegram.api.call", {
        method,
        ...call,
        durationMs: Date.now() - startedAt,
        ok: result.ok,
        // A non-ok result is not thrown by the transformer chain, so it would
        // otherwise vanish; description is Telegram's own reason string.
        ...(result.ok ? {} : { errorCode: result.error_code, error: result.description }),
      });
      return result;
    } catch (error) {
      logEvent(
        "telegram.api.failed",
        { method, ...call, durationMs: Date.now() - startedAt, ...errorFields(error) },
        "error",
      );
      throw error;
    }
  };
}

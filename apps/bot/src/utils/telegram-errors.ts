/**
 * Classification of outbound Telegram failures into *permanent* and *transient*.
 *
 * Every outbound path that mails a user on a schedule needs the same decision:
 * is it worth trying this recipient again? Retrying a transient failure (network
 * blip, 5xx, flood wait) is right; retrying a permanent one — the user blocked
 * the bot, deleted their account, or the chat is gone — is a daily no-op that
 * never converges and quietly grows the failing cohort.
 *
 * {@link isUserBlocked} is the predicate the notification scheduler already
 * consumed inline as `SchedulerDeps.isUserBlocked` (T14); it is lifted here
 * unchanged so the activation nudge classifies failures exactly the same way
 * instead of growing a second, subtly different 403 check.
 */
import { GrammyError } from "grammy";

/**
 * Telegram answers 403 when the bot may not message this user at all:
 * `Forbidden: bot was blocked by the user` and `Forbidden: user is deactivated`
 * are the two the scheduler sees. Neither can be recovered by retrying — only
 * the user un-blocking the bot changes it, and that arrives as an inbound
 * update, not as a successful send.
 */
export function isUserBlocked(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 403;
}

/**
 * `400: Bad Request: chat not found` — the chat id no longer resolves (deleted
 * account, or a stale id). Also permanent: the same send will fail identically
 * tomorrow. Kept separate from {@link isUserBlocked} because 400 covers a great
 * many *transient* or caller-side problems too, so only this exact description
 * qualifies.
 */
function isChatNotFound(err: unknown): boolean {
  return (
    err instanceof GrammyError && err.error_code === 400 && err.description.toLowerCase().includes("chat not found")
  );
}

/**
 * True when no future attempt at this recipient can succeed, so the caller must
 * stop retrying and retire them. Everything else — including 429 flood waits and
 * 5xx — is transient and must stay eligible for the next sweep.
 */
export function isPermanentDeliveryFailure(err: unknown): boolean {
  return isUserBlocked(err) || isChatNotFound(err);
}

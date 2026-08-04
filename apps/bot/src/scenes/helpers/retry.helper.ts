/**
 * Handler behind the "🔄 Try again" button attached to user-facing timeout
 * notices (see `utils/retry-action.ts`).
 */
import { isSupported, logger, type SupportedLang, t } from "@polyglot/core";
import { getRequestSettings } from "../../middlewares/request-settings.js";
import type { BotContext } from "../../types.js";
import { takeRetryAction } from "../../utils/retry-action.js";
import { handleMentorText } from "./mentor-mode.helper.js";
import { handleTranslateText } from "./translate-flow.js";

/**
 * Re-runs the operation that timed out, from the top of its flow.
 *
 * Restarting at the flow's entry point (rather than resuming mid-pipeline) is
 * deliberate: the timeout abandoned an in-flight request whose partial state is
 * not recoverable, and a fresh run re-resolves quota, model, and — for
 * translation — language detection, which is exactly what a user retyping the
 * word would get. The retried attempt is metered like any other AI call.
 */
export async function handleRetryCallback(ctx: BotContext): Promise<void> {
  const noticeMsgId = ctx.callbackQuery?.message?.message_id;
  const action = noticeMsgId === undefined ? undefined : takeRetryAction(ctx.session, noticeMsgId);

  if (!action) {
    // Restart, eviction, or a second tap on an already-used button.
    const settings = await getRequestSettings(ctx, ctx.user.id);
    const iLang = settings?.interfaceLang ?? "en";
    const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
    await ctx.answerCallbackQuery({ text: t("staleSession", lang), show_alert: true }).catch(() => {});
    // Drop the dead button so the notice cannot be tapped again.
    await ctx.editMessageReplyMarkup().catch(() => {});
    return;
  }

  // Ack before the multi-second retry so Telegram's button spinner stops.
  await ctx.answerCallbackQuery().catch(() => {});

  // Remove the notice: the retry owns the conversation from here, and leaving a
  // tappable copy behind would let a double tap launch two paid AI calls.
  if (ctx.chat && noticeMsgId !== undefined) {
    await ctx.api.deleteMessage(ctx.chat.id, noticeMsgId).catch(() => {});
  }

  logger.debug({ userId: ctx.user.id, kind: action.kind }, "Retrying timed-out operation");

  if (action.kind === "mentor") {
    await handleMentorText(ctx, action.text);
    return;
  }
  await handleTranslateText(ctx, action.text);
}

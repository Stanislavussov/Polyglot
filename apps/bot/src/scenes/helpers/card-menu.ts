/**
 * `tr:more` / `tr:less` — open and close a translation card's action list.
 *
 * Presentation only: the handler swaps the card's markup and records the new
 * state on the card, and that is all. Nothing is generated, no quota is spent,
 * the card's text is untouched, and the gate on each action stays where it
 * belongs — on the action.
 */
import { isSupported, logEvent, type SupportedLang, t } from "@polyglot/core";
import type { BotContext } from "../../types.js";
import { buildCardKeyboard } from "./card-keyboard.js";
import { answerStaleCallback } from "./stale-callback.helper.js";

async function toggleCardActions(ctx: BotContext, expanded: boolean): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const msgId = Number.parseInt(data.split(":")[2] ?? "", 10);
  const entry = Number.isFinite(msgId) ? ctx.session.translationMap?.[String(msgId)] : undefined;

  if (!entry) {
    await answerStaleCallback(ctx, { action: expanded ? "tr:more" : "tr:less", msgId });
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";

  entry.actionsExpanded = expanded;
  const keyboard = await buildCardKeyboard(ctx, entry, msgId, lang, nativeLang);

  try {
    await ctx.api.editMessageReplyMarkup(ctx.chat!.id, msgId, { reply_markup: keyboard });
  } catch {
    // Telegram refuses to edit a message older than 48 hours, so the buttons on a
    // card that far back cannot move. Say so instead of leaving a dead tap — and
    // roll the recorded state back, since the screen never changed.
    entry.actionsExpanded = !expanded;
    await ctx.answerCallbackQuery({ text: t("cardActionsUnavailable", lang), show_alert: true });
    return;
  }

  logEvent("card.actions_toggled", { expanded });
  await ctx.answerCallbackQuery();
}

/** `tr:more:{msgId}` — reveal the action list. */
export async function handleCardMoreCallback(ctx: BotContext): Promise<void> {
  await toggleCardActions(ctx, true);
}

/** `tr:less:{msgId}` — fold the action list back to `⋯ More` + Save. */
export async function handleCardLessCallback(ctx: BotContext): Promise<void> {
  await toggleCardActions(ctx, false);
}

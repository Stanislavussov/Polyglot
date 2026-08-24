/**
 * One place for "the button is live, the state behind it is gone".
 *
 * Inline keyboards live in chat history forever, but the state they act on does
 * not: `translationMap` evicts old cards, a pending prompt is one-shot, and a
 * session row can be reset. Every handler therefore needs a guard for a tap it
 * can no longer honour. Those guards used to answer with a hardcoded English
 * string and stop there, which is the "session expired" complaint users file —
 * an alert in the wrong language and no way forward.
 *
 * This module answers in the user's interface language and, when the card's
 * input is still remembered (see `recallCardWord`), follows the alert with a
 * one-tap re-translate rather than asking the user to retype the word.
 */
import { isSupported, logEvent, type SupportedLang, t } from "@polyglot/core";
import { staleCallbackCounter } from "../../metrics.js";
import { getRequestSettings } from "../../middlewares/request-settings.js";
import type { BotContext } from "../../types.js";
import { encodeTranslateRetryText, replyWithRetry } from "../../utils/retry-action.js";
import { recallCardWord } from "./translation-map.helper.js";

export interface StaleCallbackOptions {
  /** Bounded label naming the guard that fired, for logs and the metric. */
  action: string;
  /** Card message id whose remembered input can seed the retry, when there is one. */
  msgId?: number | string;
  /** Explicit input to offer instead of a card lookup (pending flows carry their own). */
  word?: string;
  contextHint?: string;
  /** Already-resolved interface language, when the caller has one. */
  lang?: SupportedLang;
}

async function resolveLang(ctx: BotContext, provided?: SupportedLang): Promise<SupportedLang> {
  if (provided) return provided;
  const settings = await getRequestSettings(ctx, ctx.user.id).catch(() => null);
  const iLang = settings?.interfaceLang ?? "en";
  return isSupported(iLang) ? iLang : "en";
}

/**
 * Answers a callback whose backing state is gone, and offers a way forward.
 *
 * Never throws: it runs on the failure path of handlers that have nothing else
 * left to say, so a second failure here would leave the user with a spinning
 * button and no message at all.
 */
export async function answerStaleCallback(ctx: BotContext, options: StaleCallbackOptions): Promise<void> {
  const lang = await resolveLang(ctx, options.lang);

  const recovered = options.word
    ? { word: options.word, contextHint: options.contextHint }
    : options.msgId !== undefined
      ? recallCardWord(ctx.session, options.msgId)
      : undefined;

  logEvent(
    "callback.stale",
    { action: options.action, msgId: options.msgId, recovered: recovered !== undefined },
    "warn",
  );
  staleCallbackCounter.inc({ action: options.action, recovered: String(recovered !== undefined) });

  await ctx.answerCallbackQuery({ text: t("staleSession", lang), show_alert: true }).catch(() => {});

  if (!recovered) return;

  // The alert is modal and gone on the next tap; the retry has to live in the
  // chat to still be there when the user comes back to it.
  await replyWithRetry(ctx, t("staleCardRetryPrompt", lang, { word: recovered.word }), lang, {
    kind: "translate",
    text: encodeTranslateRetryText(recovered.word, recovered.contextHint),
  }).catch(() => {});
}

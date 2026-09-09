/**
 * Activation-nudge callback (Task 72, slice 8).
 *
 * The D+1 nudge carries one button, and tapping it must land the user on the
 * same real card the onboarding demo would have shown. It deliberately does NOT
 * reuse the `onb:` prefix: `ONBOARDING_CALLBACK_PATTERN` is owned by the
 * onboarding handlers, which ignore taps from users who are already
 * `onboarded = true` — and every nudge recipient is, by definition, onboarded.
 * Routing this through `onb:` would make the button silently dead.
 */
import { isSupported, logger, type SupportedLang } from "@polyglot/core";
import { handleTranslateText } from "../scenes/helpers/translate-flow.js";
import type { BotContext } from "../types.js";
import { resolveHookWord, sendCachedDemoCard } from "./hook-cards.js";

/** Callback data prefix: `nudge:card:<sourceLang>:<hookWordIndex>`. */
export const NUDGE_CARD_PREFIX = "nudge:card:";

/** Registered in the bot factory alongside the other callback groups. */
export const NUDGE_CALLBACK_PATTERN = /^nudge:card:/;

/** Build the callback data for one hook word. Kept next to the parser it feeds. */
export function buildNudgeCardCallback(sourceLang: string, index: number): string {
  return `${NUDGE_CARD_PREFIX}${sourceLang}:${index}`;
}

/**
 * Render the nudged hook word as a real translation card. The cached card is the
 * fast path (no AI call at all); a cache miss falls back to the live pipeline so
 * the button always produces something.
 */
export async function handleNudgeCardCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();

  const data = ctx.callbackQuery?.data ?? "";
  const payload = data.slice(NUDGE_CARD_PREFIX.length);
  const separator = payload.lastIndexOf(":");
  const sourceLang = payload.slice(0, separator);
  const index = Number(payload.slice(separator + 1));
  const headword = separator > 0 && Number.isInteger(index) ? resolveHookWord(sourceLang, index) : null;
  if (!headword || !ctx.user) {
    logger.warn({ data, userId: ctx.user?.id }, "Unresolvable activation-nudge callback — ignoring");
    return;
  }

  // `ctx.user.settings` is never populated on this context — always read the
  // settings row explicitly.
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const interfaceLang: SupportedLang = settings && isSupported(settings.interfaceLang) ? settings.interfaceLang : "en";
  const nativeLang = settings?.nativeLang ?? null;

  if (nativeLang) {
    const served = await sendCachedDemoCard(ctx, { sourceLang, headword, nativeLang, interfaceLang });
    if (served) return;
  }

  await handleTranslateText(ctx, headword);
}

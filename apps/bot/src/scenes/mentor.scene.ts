/**
 * Mentor scene — activates mentor mode.
 *
 * In mentor mode, the user chats with an AI language assistant about grammar,
 * usage, and idioms. Persists mode change to DB so it survives bot restarts.
 */
import { FEATURE_KEYS, isSupported, type SupportedLang, t } from "@polyglot/core";
import type { BotContext } from "../types.js";
import { replyTechnical } from "../utils/message-cleanup.js";
import { ensurePaidFeatureForMessage } from "./helpers/paid-feature.helper.js";

/**
 * Handles /mentor command — activates mentor mode and starts a fresh thread.
 */
export async function handleMentorCommand(ctx: BotContext): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  // Gate BEFORE touching the mode: a refused free user must not end up stuck
  // in a mode whose every message answers with the paywall.
  if (!(await ensurePaidFeatureForMessage(ctx, FEATURE_KEYS.mentor, lang))) {
    return;
  }

  // Set active mode to mentor (session + DB)
  ctx.session.activeMode = "mentor";
  await ctx.services.userRepository.updateActiveMode(ctx.user.id, "mentor");

  // Empty object = "fresh thread, do not recover the previous one from DB";
  // the first turn mints a new thread id.
  ctx.session.mentor = {};

  await replyTechnical(ctx, t("mentorModeOn", lang));
}

/**
 * Until onboarding is complete the bot does exactly one thing: onboarding.
 *
 * Every feature reads the user's language settings, and a user who has not
 * finished onboarding has none — so a leftover feature button (a dictionary
 * card from before a dev-environment reset, a notification from a deleted
 * account), a typed `/dictionary`, or a voice note used to run the feature on an
 * empty profile. Free text is already owned by `onboardingTextMiddleware` and the
 * `onb:` / legacy `lang:` taps by their handlers; this gate closes every other
 * path by putting the user back on their current onboarding screen.
 */
import { logEvent } from "@polyglot/core";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types.js";
import {
  LEGACY_ONBOARDING_CALLBACK_PATTERN,
  ONBOARDING_CALLBACK_PATTERN,
  resumeOnboarding,
} from "./onboarding-handlers.js";

export async function onboardingGateMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const user = ctx.user;
  if (!user || user.onboarded) return next();

  if (ctx.callbackQuery) {
    const data = ctx.callbackQuery.data ?? "";
    if (ONBOARDING_CALLBACK_PATTERN.test(data) || LEGACY_ONBOARDING_CALLBACK_PATTERN.test(data)) {
      return next();
    }
    await ctx.answerCallbackQuery();
    logEvent("onboarding.gate_redirected", { kind: "callback", data });
    await resumeOnboarding(ctx);
    return;
  }

  const message = ctx.message;
  // Edited messages, chat-member updates, etc. carry nothing to onboard from.
  if (!message) return next();

  if (message.text !== undefined) {
    if (ctx.hasCommand("start")) return next();
    // Plain text is answered by onboardingTextMiddleware (demo-screen typing included).
    if (!message.text.startsWith("/")) return next();
    logEvent("onboarding.gate_redirected", { kind: "command", text: message.text });
  } else {
    logEvent("onboarding.gate_redirected", { kind: "message" });
  }
  await resumeOnboarding(ctx);
}

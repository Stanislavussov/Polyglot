import { logger } from "@polyglot/core";
import type { BotContext } from "../../types.js";

/**
 * Fallback for onboarding inline buttons (`lang:` / `learn:` / `onb:` / `level:`)
 * that arrive with NO active onboarding conversation.
 *
 * While the onboarding conversation is alive it consumes these callbacks itself,
 * so this handler only runs once the dialog has already ended — the 10-minute
 * `maxMillisecondsToWait` timeout (a user who backgrounds Telegram mid-step) or a
 * force-exit. Those callbacks are registered nowhere else and there is no
 * catch-all, so without this the tap matches no handler: the callback is never
 * answered and the button spins forever — "the bot stopped responding to
 * language selection" (2026-08-01 prod incident, new user stuck on the
 * language-selection step).
 *
 * Recovery: acknowledge the callback (stop the spinner) and, for a not-yet
 * onboarded user, drop them back into a fresh onboarding — the re-entered
 * conversation immediately re-sends the language prompt with live buttons.
 * Onboarding always restarts at step 1, so partially-written settings are simply
 * overwritten as the user progresses. An already-onboarded user (stale button on
 * an old message) just gets the spinner cleared.
 */
export async function handleStaleOnboardingCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});

  const user = ctx.user;
  if (!user || user.onboarded) {
    return;
  }

  logger.info(
    { userId: user.id, data: ctx.callbackQuery?.data },
    "Recovering stale onboarding callback — re-entering onboarding",
  );
  await ctx.conversation.enter("onboarding");
}

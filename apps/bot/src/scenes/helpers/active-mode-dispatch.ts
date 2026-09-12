/**
 * Mode dispatch — the active mode owns the user's turn, whatever shape it
 * arrived in. Typed text and a transcribed voice message both land here, so a
 * voice message sent in mentor mode reaches the mentor instead of translation,
 * and the mentor's idle re-confirm covers spoken input too.
 */
import { logEvent } from "@polyglot/core";
import { markHandled } from "../../observability/handler-log.js";
import type { BotContext } from "../../types.js";
import { maybePromptMentorIdle } from "./mentor-idle.helper.js";
import { handleMentorText } from "./mentor-mode.helper.js";
import { handleTranslateText } from "./translate-flow.js";

/** Runs the turn on the active mode's handler and records which branch took it. */
export async function dispatchByActiveMode(ctx: BotContext, text: string): Promise<void> {
  const mode = ctx.session.activeMode;

  if (mode === "mentor") {
    // Back after a long silence: ask which mode this message belongs to instead
    // of spending a paid mentor turn on what is usually a word to translate.
    if (await maybePromptMentorIdle(ctx, text)) {
      markHandled(ctx, "modeRouter:mentorIdle");
      return;
    }
    markHandled(ctx, "modeRouter:mentor");
    await handleMentorText(ctx, text);
    return;
  }

  if (mode === "translate") {
    markHandled(ctx, "modeRouter:translate");
  } else {
    // Safety net: idle must not silently drop input. Translation is always-on for
    // onboarded users, so repair the mode in session and DB, then translate.
    markHandled(ctx, "modeRouter:idleFallback");
    logEvent("mode_router.idle_fallback", { mode }, "warn");
    ctx.session.activeMode = "translate";
    await ctx.services.userRepository.updateActiveMode(ctx.user.id, "translate");
  }

  await handleTranslateText(ctx, text);
}

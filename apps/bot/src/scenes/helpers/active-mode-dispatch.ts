/**
 * Mode dispatch — the active mode owns the user's input, whatever shape it
 * arrived in. Typed text and a transcribed voice message both land here, so a
 * voice message sent in mentor mode reaches the mentor instead of translation.
 */
import { logEvent } from "@polyglot/core";
import type { BotContext, UserMode } from "../../types.js";
import { handleMentorText } from "./mentor-mode.helper.js";
import { handleTranslateText } from "./translate-flow.js";

/** Runs the turn on the active mode's handler and reports which mode took it. */
export async function dispatchByActiveMode(ctx: BotContext, text: string): Promise<UserMode> {
  const mode = ctx.session.activeMode;

  if (mode === "mentor") {
    await handleMentorText(ctx, text);
    return "mentor";
  }

  // Safety net: idle must not silently drop input. Translation is always-on for
  // onboarded users, so repair the mode in session and DB, then translate.
  if (mode !== "translate") {
    logEvent("mode_router.idle_fallback", { mode }, "warn");
    ctx.session.activeMode = "translate";
    await ctx.services.userRepository.updateActiveMode(ctx.user.id, "translate");
  }

  await handleTranslateText(ctx, text);
  return "translate";
}

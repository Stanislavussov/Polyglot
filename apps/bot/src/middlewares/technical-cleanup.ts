/**
 * Central sweep of technical messages.
 *
 * Every scene used to clear its own scaffolding, which meant most of them did
 * not: validation notices, mode confirmations and stale prompts piled up in the
 * chat forever, and any inline keyboard among them became a dead button once it
 * passed Telegram's 48h edit window. Sweeping in one place makes the rule
 * uniform — a technical message lives exactly until the user's next move.
 *
 * Message updates only. A callback query is usually a tap *on* a tracked menu,
 * so sweeping there would delete the keyboard under the user's finger; the
 * handlers that end such a flow call `cleanupTechnicalMessages` themselves.
 * Updates consumed by an active conversation never reach this middleware
 * either (it is registered after the conversation plugin), so a dialog keeps
 * its own prompts until it finishes.
 */

import type { NextFunction } from "grammy";
import type { BotContext } from "../types.js";
import { cleanupTechnicalMessages } from "../utils/message-cleanup.js";

export async function technicalCleanupMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  if (ctx.message) {
    await cleanupTechnicalMessages(ctx);
  }
  return next();
}

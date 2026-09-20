import { logEvent } from "@polyglot/core";
import type { BotContext } from "../../types.js";

/** Where the tap came from — the one dimension removal analytics are read by. */
type WordRemovalSurface = "card" | "notification" | "flashcard" | "dictionary";

/** False when there was nothing of this user's to remove: already gone, or a forged id. */
export async function removeWord(ctx: BotContext, entryId: number, surface: WordRemovalSurface): Promise<boolean> {
  const removed = await ctx.services.vocabularyRepository.delete(entryId, ctx.user.id);
  if (removed) logEvent("vocabulary.removed", { entryId, surface });
  return removed;
}

/** False when there was nothing of this user's to bring back: still live, or a forged id. */
export async function restoreWord(ctx: BotContext, entryId: number, surface: WordRemovalSurface): Promise<boolean> {
  const restored = await ctx.services.vocabularyRepository.restore(entryId, ctx.user.id);
  if (restored) logEvent("vocabulary.restored", { entryId, surface });
  return restored;
}

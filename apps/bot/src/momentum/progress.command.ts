/**
 * `/progress` — the momentum screen (Task 81, Slice 2, §2.2 S1).
 *
 * The raw score never reaches the user (§3.6): only the band phrase and the bar
 * derived from it. Under `enabled = false` the typed command makes no outgoing
 * Telegram call at all, reproducing the silence a `/progress` update met before this
 * feature existed. The callback still answers: the button is gated at render time, so
 * any tap that arrives is from a keyboard printed before the switch went off, and an
 * unanswered callback spins in the client forever.
 */
import {
  type I18nKey,
  isSupported,
  logEvent,
  MATURE_INTERVAL_DAYS,
  type MomentumBand,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { motivationProgressOpenedCounter } from "../metrics.js";
import type { BotContext } from "../types.js";

/** Where the screen was opened from — the `entry` field of `momentum.progress_opened` (§7.3). */
type ProgressEntry = "command" | "srs_done" | "flashcard_done";

export const PROGRESS_SRS_DONE_CALLBACK = "progress:open:srs_done";
export const PROGRESS_FLASHCARD_DONE_CALLBACK = "progress:open:flashcard_done";
export const PROGRESS_CALLBACK_PATTERN = /^progress:open:(srs_done|flashcard_done)$/;

/**
 * The one next step the screen offers. `srs:restart` is the existing SRS entry —
 * it builds the due deck and answers `srsEmpty` when there is nothing to review,
 * so the button stays honest at a due count of zero (§2.2 S1: one step, not a menu).
 */
const SRS_ENTRY_CALLBACK = "srs:restart";

/** Rolling window behind `progressActiveDays` — four weeks, as the copy says. */
const ACTIVE_DAYS_WINDOW = 28;

const BAND_PHRASE_KEY: Record<MomentumBand, I18nKey> = {
  resting: "progressBandResting",
  warming: "progressBandWarming",
  steady: "progressBandSteady",
  strong: "progressBandStrong",
};

const BAR_CELLS = 5;

/** Filled cells per band, matching the screen mock in §2.2 (`steady` → `▰▰▰▰▱`). */
const BAND_FILLED_CELLS: Record<MomentumBand, number> = {
  resting: 1,
  warming: 2,
  steady: 4,
  strong: 5,
};

function bandBar(band: MomentumBand): string {
  const filled = BAND_FILLED_CELLS[band];
  return "▰".repeat(filled) + "▱".repeat(BAR_CELLS - filled);
}

async function resolveLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? lang : "en";
}

async function renderProgress(ctx: BotContext, entry: ProgressEntry): Promise<void> {
  const config = await ctx.services.settings.getMotivationConfig();
  if (!config.enabled) return;

  const now = new Date();
  const userId = ctx.user.id;
  const lang = await resolveLang(ctx);
  const snapshot = await ctx.services.momentumService.getSnapshot(userId, now);
  const words = await ctx.services.vocabularyRepository.countByUser(userId);

  if (words === 0) {
    await ctx.reply([t("progressTitle", lang), "", t("progressEmpty", lang), t("progressEmptyHint", lang)].join("\n"), {
      parse_mode: "HTML",
    });
  } else {
    const [mature, due, activeDays] = await Promise.all([
      ctx.services.vocabularyRepository.countMatureTranslations(userId, MATURE_INTERVAL_DAYS),
      ctx.services.vocabularyRepository.countDueForSrs(userId, now),
      ctx.services.momentumService.countActiveDays(userId, ACTIVE_DAYS_WINDOW, now),
    ]);
    const text = [
      t("progressTitle", lang),
      "",
      t(BAND_PHRASE_KEY[snapshot.band], lang),
      bandBar(snapshot.band),
      "",
      t("progressWords", lang, { count: words }),
      t("progressMature", lang, { count: mature }),
      t("progressDue", lang, { count: due }),
      t("progressActiveDays", lang, { count: activeDays }),
    ].join("\n");
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text(t("progressReviewButton", lang, { count: due }), SRS_ENTRY_CALLBACK),
    });
  }

  logEvent("momentum.progress_opened", { band: snapshot.band, entry });
  motivationProgressOpenedCounter.inc({ band: snapshot.band });
}

export async function handleProgressCommand(ctx: BotContext): Promise<void> {
  await renderProgress(ctx, "command");
}

/**
 * A new message rather than an edit of the done card: the card is the session's
 * receipt and stays readable, and a fresh message is also the only shape immune to
 * Telegram's 48h edit limit.
 */
export async function handleProgressCallback(ctx: BotContext): Promise<void> {
  const entry: ProgressEntry =
    ctx.callbackQuery?.data === PROGRESS_FLASHCARD_DONE_CALLBACK ? "flashcard_done" : "srs_done";
  await renderProgress(ctx, entry);
  await ctx.answerCallbackQuery();
}

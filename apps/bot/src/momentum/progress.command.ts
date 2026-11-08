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
  type ProgressGoalType,
  type ProgressView,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { motivationProgressOpenedCounter } from "../metrics.js";
import { trackProductEvent } from "../observability/product-events.js";
import type { BotContext } from "../types.js";

/**
 * Where the screen was opened from — the `entry` field of `momentum.progress_opened` (§7.3).
 * `srs_done` outlived `/review` (Task 85): its done-screen buttons remain in chat history.
 */
type ProgressEntry = "command" | "srs_done" | "flashcard_done";

export const PROGRESS_FLASHCARD_DONE_CALLBACK = "progress:open:flashcard_done";
export const PROGRESS_CALLBACK_PATTERN = /^progress:open:(srs_done|flashcard_done)$/;

/**
 * The one next step the screen offers (§2.2 S1: one step, not a menu). A Cards deck
 * tops up with practice-ahead cards, so the button leads somewhere at a due count of zero.
 */
const REVIEW_ENTRY_CALLBACK = "fc:restart";

/** Rolling window behind `progressActiveDays` — four weeks, as the copy says. */
const ACTIVE_DAYS_WINDOW = 28;

const BAND_PHRASE_KEY: Record<MomentumBand, I18nKey> = {
  resting: "progressBandResting",
  warming: "progressBandWarming",
  steady: "progressBandSteady",
  strong: "progressBandStrong",
};

const GOAL_KEY: Record<ProgressGoalType, Record<MomentumBand, I18nKey>> = {
  day: {
    resting: "progressGoalDayResting",
    warming: "progressGoalDayWarming",
    steady: "progressGoalDaySteady",
    strong: "progressGoalDayStrong",
  },
  week: {
    resting: "progressGoalWeekResting",
    warming: "progressGoalWeekWarming",
    steady: "progressGoalWeekSteady",
    strong: "progressGoalWeekStrong",
  },
  month: {
    resting: "progressGoalMonthResting",
    warming: "progressGoalMonthWarming",
    steady: "progressGoalMonthSteady",
    strong: "progressGoalMonthStrong",
  },
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

function planName(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function ladderLines(view: ProgressView, band: MomentumBand, lang: SupportedLang): string[] {
  const months =
    view.countedMonths === 0
      ? t("progressGoalMonthsFirst", lang)
      : t("progressGoalMonths", lang, { count: view.cycleMonths, total: view.monthsForReward });
  return [
    months,
    t("progressGoalMonth", lang, {
      days: view.month.activeDays,
      minDays: view.month.minActiveDays,
      mature: view.month.matureGained,
      saved: view.month.savedGained,
    }),
    view.milestone
      ? t("progressGoalMilestone", lang, { target: view.milestone.target, remaining: view.milestone.remaining })
      : t("progressGoalMilestonesAll", lang),
    view.day.done
      ? t("progressGoalDayDone", lang)
      : t("progressGoalDayTodo", lang, { reviews: view.day.reviews, target: view.day.target }),
    "",
    t(GOAL_KEY[view.goal][band], lang, {
      days: view.week.days,
      target: view.goal === "week" ? view.week.target : view.day.target,
    }),
  ];
}

async function announceRewards(ctx: BotContext, view: ProgressView, lang: SupportedLang): Promise<void> {
  for (const grant of view.freshRewards) {
    const text =
      grant.action === "extend"
        ? t("progressRewardExtended", lang, { days: grant.days })
        : t("progressRewardCreated", lang, { plan: planName(grant.plan) });
    await ctx.reply(text);
    trackProductEvent(ctx, "progress.reward_granted", grant.plan);
  }
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
    const [mature, due, activeDays, ladder] = await Promise.all([
      ctx.services.vocabularyRepository.countMatureTranslations(userId, MATURE_INTERVAL_DAYS),
      ctx.services.vocabularyRepository.countDueForSrs(userId, now),
      ctx.services.momentumService.countActiveDays(userId, ACTIVE_DAYS_WINDOW, now),
      ctx.services.progressService.getProgressView(userId, now),
    ]);
    if (ladder) await announceRewards(ctx, ladder, lang);
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
      ...(ladder ? ["", ...ladderLines(ladder, snapshot.band, lang)] : []),
    ].join("\n");
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text(t("progressReviewButton", lang, { count: due }), REVIEW_ENTRY_CALLBACK),
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

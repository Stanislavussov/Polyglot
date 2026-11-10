import {
  type I18nKey,
  isSupported,
  logEvent,
  MATURE_INTERVAL_DAYS,
  type MomentumBand,
  renderProgressLadder,
  type SupportedLang,
  t,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import type { WebServices } from "../services.js";

// The bot's /progress screen (apps/bot/src/momentum/progress.command.ts): the copy comes
// from the same locale keys, so both channels say the same thing in the same words.
const ACTIVE_DAYS_WINDOW = 28;

const BAND_PHRASE_KEY: Record<MomentumBand, I18nKey> = {
  resting: "progressBandResting",
  warming: "progressBandWarming",
  steady: "progressBandSteady",
  strong: "progressBandStrong",
};

// Out of 5, as the bot's ▰▱ bar; the raw score never reaches the user (§3.6).
const BAND_LEVEL: Record<MomentumBand, number> = { resting: 1, warming: 2, steady: 4, strong: 5 };

async function learnerLang(services: WebServices, userId: number): Promise<SupportedLang> {
  const settings = await services.userRepository.getSettings(userId);
  return settings?.interfaceLang && isSupported(settings.interfaceLang) ? settings.interfaceLang : "en";
}

export function progressRoutes(app: FastifyInstance, services: WebServices): void {
  // The thin bar every page shows: only the nearest step (and a gift, if this open granted one).
  // No seen/recovery marks here — those belong to opening the Progress tab itself.
  app.get("/api/progress/goal", async (request) => {
    if (!(await services.settings.getMotivationConfig()).enabled) return { nearest: null, rewards: [] };
    const userId = request.learner.id;
    const now = new Date();
    const view = await services.progressService.getProgressView(userId, now);
    if (!view) return { nearest: null, rewards: [] };
    const [lang, snapshot] = await Promise.all([
      learnerLang(services, userId),
      services.momentumService.getSnapshot(userId, now),
    ]);
    const copy = renderProgressLadder(view, snapshot.band, lang);
    return { nearest: copy.nearest, rewards: copy.rewards };
  });

  app.get("/api/progress", async (request) => {
    const config = await services.settings.getMotivationConfig();
    if (!config.enabled) return { enabled: false };

    const userId = request.learner.id;
    const now = new Date();
    const lang = await learnerLang(services, userId);
    const momentum = services.momentumService;
    const snapshot = await momentum.getSnapshot(userId, now);
    const words = await services.vocabularyRepository.countByUser(userId);
    const [mature, due, activeDays, ladder] = await Promise.all([
      services.vocabularyRepository.countMatureTranslations(userId, MATURE_INTERVAL_DAYS),
      services.vocabularyRepository.countDueForSrs(userId, now),
      momentum.countActiveDays(userId, ACTIVE_DAYS_WINDOW, now),
      services.progressService.getProgressView(userId, now),
    ]);

    // The bot's welcome-back line after a long pause, under the same cooldown.
    let recovery: string | null = null;
    const decision = await momentum.decideRecovery(userId, now);
    if (decision.show) {
      recovery =
        due > 0 ? `${t("recoveryLine", lang)} ${t("recoveryDue", lang, { count: due })}` : t("recoveryLine", lang);
      await momentum.markRecoveryShown(userId, now);
      logEvent("momentum.recovery_shown", { gapDays: decision.gapDays, surface: "web" });
    } else {
      await momentum.touchSeen(userId, now);
    }

    logEvent("momentum.progress_opened", { band: snapshot.band, entry: "web" });
    return {
      enabled: true,
      title: t("progressTitle", lang),
      band: snapshot.band,
      level: BAND_LEVEL[snapshot.band],
      phrase: words === 0 ? t("progressEmpty", lang) : t(BAND_PHRASE_KEY[snapshot.band], lang),

      recovery,
      due,
      stats:
        words === 0
          ? []
          : [
              t("progressWords", lang, { count: words }),
              t("progressMature", lang, { count: mature }),
              t("progressDue", lang, { count: due }),
              t("progressActiveDays", lang, { count: activeDays }),
            ],
      reviewLabel: t("progressReviewButton", lang, { count: due }),
      metrics: {
        band: snapshot.band,
        words,
        mature,
        due,
        activeDays,
        ...(ladder
          ? {
              ladder: {
                day: ladder.day,
                week: ladder.week,
                month: {
                  activeDays: ladder.month.activeDays,
                  minActiveDays: ladder.month.minActiveDays,
                  mature: ladder.month.matureGained,
                  saved: ladder.month.savedGained,
                  minNewWords: ladder.month.minNewWords,
                  counted: ladder.month.counted,
                },
                cycleMonths: ladder.cycleMonths,
                monthsForReward: ladder.monthsForReward,
                rewardDays: config.progressRewardDays,
                milestone: ladder.milestone,
              },
            }
          : {}),
      },
      // Absent while the ladder is hidden, so the response is exactly what it was before.
      ...(ladder ? { ladder: renderProgressLadder(ladder, snapshot.band, lang) } : {}),
    };
  });
}

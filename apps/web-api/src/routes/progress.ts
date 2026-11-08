import {
  type I18nKey,
  isSupported,
  logEvent,
  MATURE_INTERVAL_DAYS,
  type MomentumBand,
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

export function progressRoutes(app: FastifyInstance, services: WebServices): void {
  app.get("/api/progress", async (request) => {
    const config = await services.settings.getMotivationConfig();
    if (!config.enabled) return { enabled: false };

    const userId = request.learner.id;
    const now = new Date();
    const settings = await services.userRepository.getSettings(userId);
    const lang: SupportedLang =
      settings?.interfaceLang && isSupported(settings.interfaceLang) ? settings.interfaceLang : "en";
    const momentum = services.momentumService;
    const snapshot = await momentum.getSnapshot(userId, now);
    const words = await services.vocabularyRepository.countByUser(userId);
    const [mature, due, activeDays] = await Promise.all([
      services.vocabularyRepository.countMatureTranslations(userId, MATURE_INTERVAL_DAYS),
      services.vocabularyRepository.countDueForSrs(userId, now),
      momentum.countActiveDays(userId, ACTIVE_DAYS_WINDOW, now),
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
    };
  });
}

/**
 * Notification scheduler wiring — bridges bot to notification adapter.
 *
 * Creates sendFn, builds SchedulerDeps, and starts/stops the scheduler.
 * No business logic — only dependency injection and wiring.
 */
import {
  getAllLangs,
  notificationRepository,
  userRepository,
  vocabularyRepository,
  wordReviewRepository,
} from "@polyglot/adapter-db";
import {
  createNotificationService,
  startScheduler,
  stopScheduler,
  type NotificationPayload,
  type SchedulerDeps,
} from "@polyglot/adapter-notifications";
import {
  createTopicService,
  getBuiltinTopics,
  isSupported,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { logger } from "@polyglot/core";
import type { Api, RawApi } from "grammy";
import { buildNotificationKeyboard } from "./notification.formatter.js";

/**
 * Wire and start the notification scheduler.
 *
 * @param api — grammY Bot API instance (for sending messages)
 */
export function wireNotificationScheduler(api: Api<RawApi>): void {
  // ── Build topic service for notification word picking ──
  // No AI calls for notifications — topic words come from cache/datasets only.
  // translateBatch/translateOne are stubs that return empty results.
  const topicService = createTopicService({
    translateBatch: async () => [],
    translateOne: async () => ({
      text: "",
      transcription: "",
      register: "",
      synonyms: [],
      examples: [],
    }),
    getCached: async () => null,
    setCached: async () => {},
  });

  // ── Build notification service deps ──
  const notifService = createNotificationService({
    getTopicWords: (topicId, sourceLang, targetLangs) =>
      topicService.getTopicWords(topicId, sourceLang, targetLangs),
    getBuiltinTopics,
    getUserSettings: async (userId) => {
      const settings = await userRepository.getSettings(userId);
      if (!settings) return null;
      // telegramId is not available from settings — set to 0.
      // The scheduler already has telegramId from NotificationUser (DB join).
      return {
        id: userId,
        telegramId: 0,
        timezone: settings.timezone,
        nativeLang: settings.nativeLang,
        learningLangs: settings.learningLangs,
      };
    },
    getUserVocabulary: async (userId: number) => {
      const entries = await vocabularyRepository.findByUser(userId);
      return entries.map((e) => ({
        id: e.id,
        original: e.original,
        emoji: e.emoji,
        createdAt: e.createdAt,
        translations: (e as any).translations?.map((tr: any) => ({
          targetLangId: tr.targetLangId,
          text: tr.text,
        })) ?? [],
      }));
    },
    getReviewCounts: async (userId: number) => {
      return wordReviewRepository.getReviewCounts(userId);
    },
    getLangCode: (langId: number) => {
      const all = getAllLangs();
      return all.find((l) => l.id === langId)?.code;
    },
  });

  // ── Build sendFn (notification → Telegram message) ──
  const sendFn = async (telegramId: number, payload: NotificationPayload): Promise<void> => {
    // Look up user's interface language for keyboard buttons
    const user = await userRepository.findByTelegramId(telegramId);
    let lang: SupportedLang = "en";
    if (user) {
      const settings = await userRepository.getSettings(user.id);
      if (settings?.interfaceLang && isSupported(settings.interfaceLang)) {
        lang = settings.interfaceLang as SupportedLang;
      }
    }

    const kb = buildNotificationKeyboard(lang);
    await api.sendMessage(telegramId, payload.message, {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  };

  // ── Build re-engagement sendFn ──
  const reEngagementSendFn = async (telegramId: number, message: string): Promise<void> => {
    await api.sendMessage(telegramId, message, { parse_mode: "HTML" });
  };

  // ── Build scheduler deps ──
  const schedulerDeps: SchedulerDeps = {
    getUsersForWindow: (hour: number) => notificationRepository.getUsersForWindow(hour),
    getInactiveUsers: () => notificationRepository.getInactiveUsers(),
    disableNotifications: (userId: number) => notificationRepository.disableNotifications(userId),
    pickSuggestedWord: (userId: number) => notifService.pickSuggestedWord(userId),
    pickDictionaryWord: (userId: number) => notifService.pickDictionaryWord(userId),
    t: (key: string, lang: string, params?: Record<string, string>) =>
      t(key as any, (isSupported(lang) ? lang : "en") as SupportedLang, params),
  };

  // ── Start scheduler ──
  startScheduler(sendFn, reEngagementSendFn, schedulerDeps);
  logger.info("Notification scheduler wired and started");
}

/**
 * Stop the notification scheduler gracefully.
 */
export { stopScheduler };

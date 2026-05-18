/**
 * Notification scheduler wiring — bridges bot to notification adapter.
 *
 * Creates sendFn, builds SchedulerDeps, and starts/stops the scheduler.
 * No business logic — only dependency injection and wiring.
 */
import { getAllLangs, notificationRepository, userRepository, vocabularyRepository } from "@polyglot/adapter-db";
import {
  createNotificationService,
  type NotificationPayload,
  type SchedulerDeps,
  startScheduler,
  stopScheduler,
} from "@polyglot/adapter-notifications";
import {
  createTopicService,
  getBuiltinTopics,
  type I18nKey,
  isSupported,
  logger,
  type SupportedLang,
  t,
} from "@polyglot/core";
import type { Api, RawApi } from "grammy";
import { buildNotificationKeyboard, formatNotificationMessage } from "./notification.formatter.js";

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
      synonyms: [],
      examples: [],
    }),
    getCached: async () => null,
    setCached: async () => {},
  });

  // ── Build notification service deps ──
  const notifService = createNotificationService({
    getTopicWords: (topicId, sourceLang, targetLangs) => topicService.getTopicWords(topicId, sourceLang, targetLangs),
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
        translations: e.translations.map((tr) => ({
          targetLangId: tr.targetLangId,
          text: tr.text,
        })),
      }));
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
    const message = formatNotificationMessage(payload, lang);
    await api.sendMessage(telegramId, message, {
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
    getUsersForWindow: (hour: number, minute = 0) => notificationRepository.getUsersForWindow(hour, minute),
    getInactiveUsers: () => notificationRepository.getInactiveUsers(),
    disableNotifications: (userId: number) => notificationRepository.disableNotifications(userId),
    getRecentSentWords: (userId: number, limit = 3) => notificationRepository.getRecentSentWords(userId, limit),
    recordSentWord: (userId: number, original: string, source: string) =>
      notificationRepository.recordSentWord(userId, original, source),
    pickSuggestedWord: (userId: number, recentWords) => notifService.pickSuggestedWord(userId, recentWords),
    pickDictionaryWord: (userId: number, recentWords) => notifService.pickDictionaryWord(userId, recentWords),
    t: (key: string, lang: string, params?: Record<string, string>) =>
      t(key as I18nKey, (isSupported(lang) ? lang : "en") as SupportedLang, params),
  };

  // ── Start scheduler ──
  startScheduler(sendFn, reEngagementSendFn, schedulerDeps);
  logger.info("Notification scheduler wired and started");
}

/**
 * Stop the notification scheduler gracefully.
 */
export { stopScheduler };

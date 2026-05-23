import { getAllLangs, notificationRepository, userRepository, vocabularyRepository } from "@polyglot/adapter-db";
import {
  createNotificationService,
  type NotificationPayload,
  type SchedulerDeps,
  startScheduler,
  stopScheduler,
} from "@polyglot/adapter-notifications";
import { isSupported, logger, type SupportedLang, t } from "@polyglot/core";
import type { Api, RawApi } from "grammy";
import { buildNotificationKeyboard, formatNotificationMessage } from "./notification.formatter.js";

export function wireNotificationScheduler(api: Api<RawApi>): void {
  const notifService = createNotificationService({
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

  const sendFn = async (telegramId: number, payload: NotificationPayload): Promise<void> => {
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

  const reEngagementSendFn = async (telegramId: number, message: string): Promise<void> => {
    await api.sendMessage(telegramId, message, { parse_mode: "HTML" });
  };

  const schedulerDeps: SchedulerDeps = {
    getUsersForWindow: (hour: number, minute = 0) => notificationRepository.getUsersForWindow(hour, minute),
    getInactiveUsers: () => notificationRepository.getInactiveUsers(),
    disableNotifications: (userId: number) => notificationRepository.disableNotifications(userId),
    getRecentSentWords: (userId: number, limit = 3) => notificationRepository.getRecentSentWords(userId, limit),
    recordSentWord: (userId: number, original: string, source: string) =>
      notificationRepository.recordSentWord(userId, original, source),
    pickDictionaryWord: (userId: number, recentWords) => notifService.pickDictionaryWord(userId, recentWords),
    sendDictionaryEmptyPrompt: async (telegramId: number, lang: string) => {
      await api.sendMessage(
        telegramId,
        t("notifNoDictionary" as never, (isSupported(lang) ? lang : "en") as SupportedLang),
      );
    },
    t: (key: string, lang: string, params?: Record<string, string>) =>
      t(key as never, (isSupported(lang) ? lang : "en") as SupportedLang, params),
  };

  startScheduler(sendFn, reEngagementSendFn, schedulerDeps);
  logger.info("Notification scheduler wired and started");
}

export { stopScheduler };

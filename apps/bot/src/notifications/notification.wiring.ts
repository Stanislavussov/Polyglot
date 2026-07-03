import { generateObject } from "@polyglot/adapter-ai";
import {
  getAllLangs,
  getLang,
  notificationRepository,
  settingsAdapter,
  userRepository,
  vocabularyRepository,
} from "@polyglot/adapter-db";
import {
  createNotificationService,
  type NotificationPayload,
  type SchedulerDeps,
  startScheduler,
  stopScheduler,
} from "@polyglot/adapter-notifications";
import { type GenerateObjectFn, isSupported, logger, SettingsService, type SupportedLang, t } from "@polyglot/core";
import type { Api, RawApi } from "grammy";
import { z } from "zod";
import { resolveDefaultAIModel } from "../utils/ai-model.js";
import { buildNotificationKeyboard, formatNotificationMessage } from "./notification.formatter.js";

const jitTranslationSchema = z.object({
  translations: z.array(
    z.object({
      languageCode: z.string(),
      text: z.string(),
    }),
  ),
});

export async function wireNotificationScheduler(api: Api<RawApi>): Promise<void> {
  const settings = new SettingsService(settingsAdapter);
  const contextualModel = await resolveDefaultAIModel(settings);
  const notifService = createNotificationService({
    getUserVocabulary: async (userId: number) => {
      const entries = await vocabularyRepository.findByUser(userId);
      return entries.map((e) => ({
        id: e.id,
        original: e.original,
        emoji: e.emoji,
        nativeMeaning: e.nativeMeaning,
        createdAt: e.createdAt,
        unverified: e.unverified,
        translations: e.translations.map((tr) => ({
          targetLangId: tr.targetLangId,
          text: tr.text,
          synonyms: tr.details?.synonyms?.map((s) => s.text) ?? [],
        })),
      }));
    },
    getLangCode: (langId: number) => {
      const all = getAllLangs();
      return all.find((l) => l.id === langId)?.code;
    },
    generateObject: ((prompt, schema, model, options) => {
      return generateObject(prompt, schema, model, options);
    }) satisfies GenerateObjectFn,
    contextualModel,
    translateEntry: async (userId: number, entryId: number) => {
      const entry = await vocabularyRepository.findById(entryId);
      if (!entry) return null;

      const userSettings = await userRepository.getSettings(userId);
      if (!userSettings) return null;

      const targetLangs = userSettings.learningLangs;
      if (targetLangs.length === 0) return null;

      const sourceLang = getAllLangs().find((l) => l.id === entry.sourceLangId);
      if (!sourceLang) return null;

      const model = contextualModel;
      if (!model) return null;

      const prompt = `Translate the following phrase from ${sourceLang.name} into these languages: ${targetLangs.join(", ")}.

Phrase: "${entry.original}"

Return translations as JSON array.`;

      const result = await generateObject(prompt, jitTranslationSchema, model, { userId });

      const translations: Array<{ targetLangId: number; text: string; synonyms?: string[] }> = [];
      for (const tr of result.translations) {
        const lang = getLang(tr.languageCode);
        if (lang) {
          translations.push({ targetLangId: lang.id, text: tr.text });
          // Save to DB for future use (upsert)
          await vocabularyRepository.updateTranslation(entryId, lang.id, { text: tr.text });
        }
      }
      return translations.length > 0 ? translations : null;
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

    const kb = buildNotificationKeyboard(lang, payload.word.entryId);
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
    getSentWordsSince: (userId: number, since: Date) => notificationRepository.getSentWordsSince(userId, since),
    recordSentWord: (userId: number, original: string, source: string) =>
      notificationRepository.recordSentWord(userId, original, source),
    pickDictionaryWord: (userId: number, recentWords) => notifService.pickDictionaryWord(userId, recentWords),
    pickContextualWord: (userId: number, context: string, langs, recentWords) =>
      notifService.pickContextualWord(userId, context, langs, recentWords),
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

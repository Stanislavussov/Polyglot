import { generateObject } from "@polyglot/adapter-ai";
import {
  getAllLangs,
  getLang,
  identityRepository,
  notificationRepository,
  onboardingDemoCardRepository,
  settingsAdapter,
  subscriptionRepository,
  userRepository,
  vocabularyRepository,
} from "@polyglot/adapter-db";
import {
  createNotificationService,
  createPresetWordPicker,
  type NotificationPayload,
  type SchedulerDeps,
  startScheduler,
  stopScheduler,
} from "@polyglot/adapter-notifications";
import {
  type AIFailover,
  createSubscriptionService,
  type GenerateObjectFn,
  isSupported,
  logger,
  type ServiceContainer,
  SettingsService,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { type Api, type RawApi } from "grammy";
import { z } from "zod";
import { mockPaymentAdapter } from "../payment.js";
import { buildAiFailover, resolveDefaultAIModel, resolveFallbackAIModel } from "../utils/ai-model.js";
import { clampAiBudgetToOpGuard } from "../utils/long-op.js";
import { isUserBlocked } from "../utils/telegram-errors.js";
import { buildNotificationKeyboard, formatNotificationMessage } from "./notification.formatter.js";

const jitTranslationSchema = z.object({
  translations: z.array(
    z.object({
      languageCode: z.string(),
      text: z.string(),
    }),
  ),
});

/**
 * Resolve the Telegram chat id for a neutral userId on the outbound path
 * (Fable T24/A1, hardened after T24 review).
 *
 * The identity port is the source of truth, but migration `0044` creates the
 * `identities` table without a backfill, so at deploy every existing user — and
 * the entire dormant re-engagement cohort, which sends no inbound message to
 * self-heal — has no identity row. Resolving *exclusively* through identities
 * would silently skip their scheduled notifications. So on a miss we fall back
 * to the retained legacy `users.telegram_id` column and opportunistically link
 * an identity (idempotent `onConflictDoNothing`), self-healing the row on this
 * send. Only when BOTH the identity and the legacy column are absent do we skip.
 */
export async function resolveTelegramChatId(
  userId: number,
  services: Pick<ServiceContainer, "identityRepository" | "userRepository">,
): Promise<number | null> {
  const externalId = await services.identityRepository.findExternalId(userId, "telegram");
  if (externalId) {
    return Number(externalId);
  }

  const legacyTelegramId = await services.userRepository.getTelegramIdById(userId);
  if (legacyTelegramId === null) {
    logger.warn({ userId }, "No telegram identity or legacy telegram_id for user — skipping notification send");
    return null;
  }

  // Self-heal the identity row so the next send resolves through the port.
  await services.identityRepository.linkIdentity(userId, "telegram", String(legacyTelegramId));
  return legacyTelegramId;
}

/**
 * Build the three pieces the scheduler runs on — without starting it.
 *
 * Split out of {@link wireNotificationScheduler} so an integration test can drive
 * the *real* delivery pipeline (real repository, real identity resolution with the
 * legacy `telegram_id` fallback, real message formatting, real `api.sendMessage`)
 * by calling `checkAndSend(sendFn, deps)` directly, with no half-hourly cron
 * running inside the test issuing a second, uncounted send.
 */
export interface NotificationSchedulingOverrides {
  /**
   * Replaces the module-level `generateObject` for BOTH just-in-time AI paths —
   * `translateEntry` (dictionary entry with no translations) and
   * `translateHeadword` (preset cache miss). Production passes nothing.
   *
   * There is exactly one seam because there are exactly two paths and closing
   * only one is worse than closing neither: a test that nulls `pickPresetWord`
   * still reaches `translateEntry` on its own happy path, which would issue a
   * live, billable model call AND write a translation row to the database. Note
   * that a *throwing* stub is not self-enforcing here — `pickDictionaryWord`
   * catches `translateEntry` failures (notification.service.ts) — so a test must
   * also assert the override was never called.
   */
  generateObject?: GenerateObjectFn;
}

export async function buildNotificationScheduling(
  api: Api<RawApi>,
  overrides: NotificationSchedulingOverrides = {},
): Promise<{
  sendFn: (userId: number, payload: NotificationPayload) => Promise<void>;
  reEngagementSendFn: (userId: number, message: string) => Promise<void>;
  deps: SchedulerDeps;
}> {
  const settings = new SettingsService(settingsAdapter);
  const contextualModel = await resolveDefaultAIModel(settings);

  // Scheduled-notification JIT translations run in the background, but they must
  // still fail over on a transient primary-model error just like foreground bot
  // traffic does — otherwise a background 429/5xx silently drops the translation.
  // Resolve the split per-call from the same admin-managed budget the container
  // uses (clamped requestTimeoutMs), so an admin change takes effect without a
  // redeploy. Returns undefined when the budget is too small to split — then the
  // call runs unsplit, matching container behaviour.
  const resolveFailover = async (): Promise<AIFailover | undefined> => {
    const [defaults, fallbackModel] = await Promise.all([
      settings.getAIGenerationDefaults(),
      resolveFallbackAIModel(settings),
    ]);
    return buildAiFailover(clampAiBudgetToOpGuard(defaults.requestTimeoutMs), fallbackModel);
  };

  // Single AI entry point for both JIT paths — see NotificationSchedulingOverrides.
  const callAI: GenerateObjectFn = overrides.generateObject ?? generateObject;

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
    generateObject: (async (prompt, schema, model, options) => {
      return callAI(prompt, schema, model, { ...options, failover: await resolveFailover() });
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

      const result = await callAI(prompt, jitTranslationSchema, model, {
        userId,
        failover: await resolveFailover(),
      });

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

  // The scheduler now hands us the neutral userId (Fable T24/A1); this channel
  // adapter resolves the Telegram chat id via the identity port (with a legacy
  // telegram_id fallback) before sending — see resolveTelegramChatId.
  const resolveTelegramId = (userId: number): Promise<number | null> =>
    resolveTelegramChatId(userId, { identityRepository, userRepository });

  const sendFn = async (userId: number, payload: NotificationPayload): Promise<void> => {
    const telegramId = await resolveTelegramId(userId);
    if (telegramId === null) return;

    let lang: SupportedLang = "en";
    const settings = await userRepository.getSettings(userId);
    if (settings?.interfaceLang && isSupported(settings.interfaceLang)) {
      lang = settings.interfaceLang as SupportedLang;
    }

    const kb = buildNotificationKeyboard(lang, payload.word.entryId);
    const message = formatNotificationMessage(payload, lang);
    await api.sendMessage(telegramId, message, {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  };

  const reEngagementSendFn = async (userId: number, message: string): Promise<void> => {
    const telegramId = await resolveTelegramId(userId);
    if (telegramId === null) return;
    await api.sendMessage(telegramId, message, { parse_mode: "HTML" });
  };

  // The preset layer's free source: cards already rendered and human-reviewed
  // for the onboarding demo. Serving them costs nothing and their quality is
  // already vetted, so they are tried before any AI call.
  const presetPicker = createPresetWordPicker({
    findDemoCard: async (sourceLang, nativeLang, headword) => {
      const card = await onboardingDemoCardRepository.findOne(sourceLang, nativeLang, headword);
      if (!card) return null;
      const translations: Record<string, string> = {};
      for (const [code, translation] of Object.entries(card.payload.translations)) {
        translations[code] = translation.text;
      }
      return {
        ...(card.payload.emoji !== undefined && { emoji: card.payload.emoji }),
        ...(card.payload.nativeMeaning !== undefined && { nativeMeaning: card.payload.nativeMeaning }),
        translations,
      };
    },
    // Without this the layer would only cover the (learning, native) pairs the
    // warm-up script has been run for, and would silently do nothing for
    // everyone else — the exact way the demo cache sat unusable once before.
    translateHeadword: async (headword, sourceLang, nativeLang) => {
      const model = contextualModel;
      if (!model) return null;
      const prompt = `Translate the word or phrase "${headword}" from ${sourceLang} into ${nativeLang}.

Return translations as JSON array.`;
      const result = await callAI(prompt, jitTranslationSchema, model, {
        failover: await resolveFailover(),
      });
      const translations: Record<string, string> = {};
      for (const tr of result.translations) {
        translations[tr.languageCode] = tr.text;
      }
      return Object.keys(translations).length > 0 ? { translations } : null;
    },
  });

  const schedulerDeps: SchedulerDeps = {
    getUsersForWindow: (hour: number, minute = 0) => notificationRepository.getUsersForWindow(hour, minute),
    getLastSentWord: (userId: number) => notificationRepository.getLastSentWord(userId),
    pickPresetWord: (user, recentWords) => presetPicker(user, recentWords),
    getInactiveUsers: () => notificationRepository.getInactiveUsers(),
    disableNotifications: (userId: number) => notificationRepository.disableNotifications(userId),
    // Telegram 403 = the user blocked the bot: a permanent failure, so the
    // scheduler stops retrying and disables their notifications (T14). Shared
    // with the activation nudge so both paths classify failures identically.
    isUserBlocked,
    getSentWordsSince: (userId: number, since: Date) => notificationRepository.getSentWordsSince(userId, since),
    recordSentWord: (userId: number, original: string, source: string) =>
      notificationRepository.recordSentWord(userId, original, source),
    pickDictionaryWord: (userId: number, recentWords) => notifService.pickDictionaryWord(userId, recentWords),
    pickContextualWord: (userId: number, context: string, langs, recentWords) =>
      notifService.pickContextualWord(userId, context, langs, recentWords),
    sendDictionaryEmptyPrompt: async (userId: number, lang: string) => {
      const telegramId = await resolveTelegramId(userId);
      if (telegramId === null) return;
      await api.sendMessage(
        telegramId,
        t("notifNoDictionary" as never, (isSupported(lang) ? lang : "en") as SupportedLang),
      );
    },
    t: (key: string, lang: string, params?: Record<string, string>) =>
      t(key as never, (isSupported(lang) ? lang : "en") as SupportedLang, params),
    processSubscriptionRenewals: () =>
      createSubscriptionService({
        payment: mockPaymentAdapter,
        subscriptions: subscriptionRepository,
        users: userRepository,
      }).processRenewals(),
  };

  return { sendFn, reEngagementSendFn, deps: schedulerDeps };
}

export async function wireNotificationScheduler(api: Api<RawApi>): Promise<void> {
  const { sendFn, reEngagementSendFn, deps } = await buildNotificationScheduling(api);
  startScheduler(sendFn, reEngagementSendFn, deps);
  logger.info("Notification scheduler wired and started");
}

export { stopScheduler };

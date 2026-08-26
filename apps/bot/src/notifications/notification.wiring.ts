import { generateObject } from "@polyglot/adapter-ai";
import {
  getAllLangs,
  getLang,
  identityRepository,
  momentumRepository,
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
  errorFields,
  type GenerateObjectFn,
  isSupported,
  localDayKey,
  logEvent,
  logger,
  type ServiceContainer,
  SettingsService,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { type Api, type RawApi } from "grammy";
import { z } from "zod";
import { notificationCounter } from "../metrics.js";
import { mockPaymentAdapter } from "../payment.js";
import { buildAiFailover, resolveDefaultAIModel, resolveFallbackAIModel } from "../utils/ai-model.js";
import { languageOrderFromSettings } from "../utils/language-order.js";
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
  /**
   * The clock the weekly proof line reads (Task 81, S4). Injected for the same
   * reason `SchedulerDeps.now` is: "not more than once per 7 days" is only
   * testable against time the test controls, and every momentum timestamp is
   * written by the application rather than by the database (§4.4).
   */
  now?: () => Date;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The weekly proof line, prepared but not yet claimed.
 *
 * Split in two because the week must be burned only by a delivery that actually
 * happened: a send that throws goes back through the scheduler's retry ladder, and
 * a token recorded before it would silence the retry's card for the next 7 days.
 */
interface WeeklyProof {
  line: string;
  commit: () => Promise<void>;
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
  const now = overrides.now ?? ((): Date => new Date());

  /**
   * The motivation layer's only outbound surface (Task 81, §2.2 S4): one line
   * inside an already-subscribed notification, at most once every 7 days.
   *
   * This file has no `ctx.services`, so — per §4.1 — the repository comes straight
   * from `@polyglot/adapter-db` and the kill switch is read through the same
   * `SettingsService` instance the rest of the file uses, on every call rather than
   * latched, so switching `motivation.enabled` off takes effect without a redeploy.
   *
   * Returns `null` on any failure: the momentum layer must never cost a user their
   * notification (§4.2).
   */
  const prepareWeeklyProof = async (
    userId: number,
    lang: SupportedLang,
    timezone: string,
  ): Promise<WeeklyProof | null> => {
    try {
      const motivation = await settings.getMotivationConfig();
      // Both switches, not just the surface one: the "once per 7 days" rule is held by
      // a `weekly_proof` row, so with recording off the line would have no token to
      // stop it and would ride every single notification — and a surface that keeps
      // growing `momentum_events` is exactly what `recordingEnabled = false` denies.
      if (!motivation.recordingEnabled || !motivation.enabled) return null;

      const at = now();
      const since = new Date(at.getTime() - WEEK_MS);
      // A rolling window, not a calendar week: "once per 7 days" must not let a
      // Sunday send and a Monday send both through.
      if ((await momentumRepository.countEventsSince(userId, "weekly_proof", since)) > 0) return null;

      const [mature, reviews] = await Promise.all([
        momentumRepository.countEventsSince(userId, "mature", since),
        momentumRepository.countEventsSince(userId, "review", since),
      ]);
      // Praise is paid for by evidence (§0.1): a week of zeroes has nothing to prove.
      if (mature === 0 && reviews === 0) return null;

      return {
        line: t("weeklyProofLine", lang, { mature, reviews }),
        commit: async () => {
          try {
            await momentumRepository.recordEvent({
              userId,
              kind: "weekly_proof",
              weight: 0,
              occurredAt: at,
              dedupeKey: `weekly_proof:${localDayKey(timezone, at)}`,
            });
            logEvent("momentum.weekly_line_shown", { mature, reviews });
          } catch (err) {
            logEvent("momentum.record_failed", { kind: "weekly_proof", ...errorFields(err) }, "error");
          }
        },
      };
    } catch (err) {
      logEvent("momentum.record_failed", { kind: "weekly_proof", ...errorFields(err) }, "error");
      return null;
    }
  };

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
        difficulty: e.difficulty ?? undefined,
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

  /**
   * Delivery outcomes on `bot_notifications_total` (Task 78), enumerated like
   * the activation nudge's `NUDGE_STATUSES` to bound cardinality.
   *
   * `polyglot_bot_notification_failures` alerts on `delivery_failed` alone.
   * Blocked users accrue steadily on a healthy bot, so counting them as
   * failures would page for normal churn; `delivery_skipped` (no resolvable
   * chat id, nothing attempted) stays out of the ratio entirely.
   */
  const DELIVERY_STATUSES = ["delivery_sent", "delivery_failed", "delivery_blocked", "delivery_skipped"] as const;
  type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

  const countDelivery = (status: DeliveryStatus): void => {
    notificationCounter.inc({ status });
  };

  /**
   * Counts the outcome, then re-throws. The re-throw is load-bearing: the
   * scheduler needs the rejection to run its retry ladder and to disable
   * notifications for a blocked user. It lives here rather than in the
   * scheduler because that package must never import from the bot.
   */
  const withDeliveryMetrics = async (send: () => Promise<unknown>): Promise<void> => {
    try {
      await send();
      countDelivery("delivery_sent");
    } catch (err) {
      countDelivery(isUserBlocked(err) ? "delivery_blocked" : "delivery_failed");
      throw err;
    }
  };

  const sendFn = async (userId: number, payload: NotificationPayload): Promise<void> => {
    const telegramId = await resolveTelegramId(userId);
    if (telegramId === null) {
      countDelivery("delivery_skipped");
      return;
    }

    let lang: SupportedLang = "en";
    const settings = await userRepository.getSettings(userId);
    if (settings?.interfaceLang && isSupported(settings.interfaceLang)) {
      lang = settings.interfaceLang as SupportedLang;
    }

    const kb = buildNotificationKeyboard(lang, payload.word.entryId);
    const weeklyProof = await prepareWeeklyProof(userId, lang, settings?.timezone ?? "UTC");
    // Derived here, at render time, from the settings row already loaded above —
    // so the card's language order never depends on the payload's key order,
    // which would not survive a queue or worker boundary.
    const message = formatNotificationMessage(
      payload,
      lang,
      languageOrderFromSettings(settings),
      weeklyProof ? { footer: weeklyProof.line } : {},
    );
    await withDeliveryMetrics(() =>
      api.sendMessage(telegramId, message, {
        parse_mode: "HTML",
        reply_markup: kb,
      }),
    );
    await weeklyProof?.commit();
  };

  const reEngagementSendFn = async (userId: number, message: string): Promise<void> => {
    const telegramId = await resolveTelegramId(userId);
    if (telegramId === null) {
      countDelivery("delivery_skipped");
      return;
    }
    await withDeliveryMetrics(() => api.sendMessage(telegramId, message, { parse_mode: "HTML" }));
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

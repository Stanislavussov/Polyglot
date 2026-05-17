/**
 * Notification Scheduler — cron-based, timezone-aware delivery.
 *
 * Rules:
 * 1. Single cron job for all users — no job per user
 * 2. On send error — log and continue, never stop the scheduler
 * 3. Receives sendFn via injection — never imports bot
 * 4. Timezone and time slot constants come from DB (injected via deps)
 * 5. Uses core's getLogger() — logger injected at composition root
 */

import { getLogger } from "@polyglot/core";
import cron from "node-cron";
import { logNotificationSent } from "./log.js";
import type {
  NotificationPayload,
  NotificationUser,
  ReEngagementSendFn,
  SchedulerDeps,
  SendFn,
  SuggestedWord,
} from "./types.js";

/** Internal state for the running cron task. */
let cronTask: cron.ScheduledTask | null = null;

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

async function sendWithRetry(sendFn: SendFn, telegramId: number, payload: NotificationPayload): Promise<void> {
  const logger = getLogger();
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await sendFn(telegramId, payload);
      return;
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        logger.warn({ err, telegramId, attempt: attempt + 1 }, "Send failed — retrying after delay");
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Pick a word for a user based on their notification type preference.
 *
 * Strategy:
 * - 'srs' → try dictionary word, fallback to suggested
 * - 'suggested' → AI-suggested word only
 * - 'both' → randomly alternate between the two
 */
async function pickWordForUser(
  user: NotificationUser,
  deps: SchedulerDeps,
  recentWords: string[],
): Promise<SuggestedWord | null> {
  const { notificationType } = user;

  if (notificationType === "suggested") {
    return deps.pickSuggestedWord(user.userId, recentWords);
  }

  if (notificationType === "srs") {
    const dictWord = await deps.pickDictionaryWord(user.userId, recentWords);
    if (dictWord) return dictWord;
    // Fallback to suggested if no dictionary words
    getLogger().info({ userId: user.userId }, "No dictionary word — falling back to AI suggestion");
    return deps.pickSuggestedWord(user.userId, recentWords);
  }

  // 'both' — randomly pick between the two strategies
  const useSrs = Math.random() < 0.5;
  if (useSrs) {
    const dictWord = await deps.pickDictionaryWord(user.userId, recentWords);
    if (dictWord) return dictWord;
    return deps.pickSuggestedWord(user.userId, recentWords);
  }
  const suggested = await deps.pickSuggestedWord(user.userId, recentWords);
  if (suggested) return suggested;
  return deps.pickDictionaryWord(user.userId, recentWords);
}

/**
 * Build a notification payload for the given user and word.
 *
 * Formats the message using i18n and the user's interface language.
 */
export function buildNotificationPayload(
  user: NotificationUser,
  word: SuggestedWord,
  t: (key: string, lang: string, params?: Record<string, string>) => string,
): NotificationPayload {
  const lang = user.interfaceLang;
  const timeParts = (user.notificationTime || "08:00").split(":");
  const hour = Number.parseInt(timeParts[0], 10) || 8;

  // Build a plain-text message with translations
  const title = t("notifTitle", lang);
  const sourceLabel = word.source === "srs" ? t("notifWordFromDict", lang) : t("notifAiSuggested", lang);

  const translationLines = Object.entries(word.translations)
    .map(([, text]) => `  • ${text}`)
    .join("\n");

  const message = [
    `${word.emoji} <b>${word.original}</b>`,
    `<i>${sourceLabel}</i>`,
    "",
    `${title}:`,
    translationLines,
  ].join("\n");

  return {
    hour,
    word,
    message,
  };
}

/**
 * Process one hourly tick: find eligible users, pick words, send notifications.
 */
export async function checkAndSend(sendFn: SendFn, deps: SchedulerDeps): Promise<{ sent: number; errors: number }> {
  const logger = getLogger();
  const now = Temporal.Now.zonedDateTimeISO("UTC");
  const utcHour = now.hour;
  const utcMinute = now.minute;
  let sent = 0;
  let errors = 0;

  // Step 1: Get users whose local time matches their preferred notification window
  let users: NotificationUser[];
  try {
    users = await deps.getUsersForWindow(utcHour, utcMinute);
  } catch (err) {
    logger.error({ err, utcHour, utcMinute }, "Failed to query users for notification window");
    return { sent: 0, errors: 1 };
  }

  if (users.length === 0) {
    logger.debug({ utcHour, utcMinute }, "No users eligible for notification at this time");
    return { sent: 0, errors: 0 };
  }

  logger.info({ utcHour, utcMinute, userCount: users.length }, "Processing notification batch");

  // Step 2: For each user, pick a word and send
  for (const user of users) {
    try {
      const recentWords = await deps.getRecentSentWords(user.userId);
      const word = await pickWordForUser(user, deps, recentWords);
      if (!word) {
        logger.warn({ userId: user.userId }, "Could not pick a word for user — skipping");
        continue;
      }

      const payload = buildNotificationPayload(user, word, deps.t);
      await sendWithRetry(sendFn, user.telegramId, payload);

      await deps.recordSentWord(user.userId, word.original, word.source ?? "suggested");
      logNotificationSent({
        userId: user.userId,
        type: word.source ?? "suggested",
      });

      sent++;
    } catch (err) {
      // Rule: log and continue — never stop the scheduler
      logger.error(
        { err, userId: user.userId, telegramId: user.telegramId },
        "Failed to send notification — continuing",
      );
      errors++;
    }
  }

  logger.info({ utcHour, utcMinute, sent, errors }, "Notification batch complete");
  return { sent, errors };
}

/**
 * Process inactive users: send re-engagement message and disable notifications.
 */
export async function processInactiveUsers(
  reEngagementSendFn: ReEngagementSendFn,
  deps: SchedulerDeps,
): Promise<{ processed: number; errors: number }> {
  const logger = getLogger();
  let processed = 0;
  let errors = 0;

  let inactiveUsers: NotificationUser[];
  try {
    inactiveUsers = await deps.getInactiveUsers();
  } catch (err) {
    logger.error({ err }, "Failed to query inactive users");
    return { processed: 0, errors: 1 };
  }

  if (inactiveUsers.length === 0) {
    return { processed: 0, errors: 0 };
  }

  logger.info({ count: inactiveUsers.length }, "Processing inactive users for re-engagement");

  for (const user of inactiveUsers) {
    try {
      const message = deps.t("notifPaused", user.interfaceLang);
      await reEngagementSendFn(user.telegramId, message);
      await deps.disableNotifications(user.userId);
      processed++;
      logger.info({ userId: user.userId }, "Sent re-engagement message and disabled notifications");
    } catch (err) {
      logger.error({ err, userId: user.userId }, "Failed to process inactive user — continuing");
      errors++;
    }
  }

  return { processed, errors };
}

/**
 * Start the notification scheduler.
 *
 * Runs a single cron job every hour (0 * * * *) that:
 * 1. Queries users whose local time matches their notification window
 * 2. Picks a word (SRS/suggested) based on user preference
 * 3. Sends the notification via sendFn
 *
 * Also checks for inactive users once daily at midnight UTC.
 *
 * @param sendFn — injected send function (from bot)
 * @param reEngagementSendFn — send function for plain text re-engagement messages
 * @param deps — scheduler dependencies (repos, pickers, i18n)
 */
export function startScheduler(sendFn: SendFn, reEngagementSendFn: ReEngagementSendFn, deps: SchedulerDeps): void {
  const logger = getLogger();
  if (cronTask) {
    logger.warn({}, "Scheduler already running — ignoring duplicate startScheduler call");
    return;
  }

  logger.info({}, "Starting notification scheduler (* * * * *)");

  cronTask = cron.schedule("* * * * *", async () => {
    const now = Temporal.Now.zonedDateTimeISO("UTC");
    logger.info({ utcHour: now.hour, utcMinute: now.minute }, "Scheduler tick");
    try {
      await checkAndSend(sendFn, deps);

      // Process inactive users once daily at midnight UTC
      if (now.hour === 0 && now.minute === 0) {
        await processInactiveUsers(reEngagementSendFn, deps);
      }
    } catch (err) {
      // Catch-all safety net — cron must never crash
      logger.error({ err }, "Unhandled error in scheduler tick");
    }
  });
}

/**
 * Stop the notification scheduler gracefully.
 */
export function stopScheduler(): void {
  const logger = getLogger();
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info({}, "Notification scheduler stopped");
  }
}

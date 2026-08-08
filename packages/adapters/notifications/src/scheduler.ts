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

import { getLogger, getTraceContext, logEvent, newTraceId, runWithTrace } from "@polyglot/core";
import cron from "node-cron";
import { logNotificationSent } from "./log.js";
import type {
  NotificationPayload,
  NotificationType,
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

/** Rolling window for de-dup: don't repeat a word sent within the last 24h. */
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
  label: string,
): Promise<T> {
  const logger = getLogger();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        logger.warn({ err, attempt, maxRetries, delayMs: delay, label }, `Retrying ${label} after error`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

async function sendWithRetry(
  sendFn: SendFn,
  userId: number,
  payload: NotificationPayload,
  isPermanent?: (err: unknown) => boolean,
): Promise<void> {
  const logger = getLogger();
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await sendFn(userId, payload);
      return;
    } catch (err) {
      // A permanent failure (e.g. the user blocked the bot, Telegram 403) will
      // never succeed — stop immediately instead of burning retries on it.
      if (isPermanent?.(err)) {
        throw err;
      }
      if (attempt < MAX_RETRIES - 1) {
        logger.warn({ err, userId, attempt: attempt + 1 }, "Send failed — retrying after delay");
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      } else {
        throw err;
      }
    }
  }
}

/** Picks the suggested word for a user of a given notification type. */
type WordPicker = (user: NotificationUser, deps: SchedulerDeps, recentWords: string[]) => Promise<SuggestedWord | null>;

const pickFromDictionary: WordPicker = (user, deps, recentWords) => deps.pickDictionaryWord(user.userId, recentWords);

/**
 * Registry mapping each notification type to its word picker. Adding a new
 * notification type is a matter of registering an entry here — the `Record`
 * over the closed {@link NotificationType} union makes TypeScript flag a missing
 * picker at compile time, so no `switch` needs editing (Fable T29/A19).
 */
const WORD_PICKERS: Record<NotificationType, WordPicker> = {
  srs: pickFromDictionary,
  suggested: pickFromDictionary,
  contextual: (user, deps, recentWords) =>
    user.notificationContext
      ? deps.pickContextualWord(
          user.userId,
          user.notificationContext,
          { nativeLang: user.nativeLang, learningLangs: user.learningLangs },
          recentWords,
        )
      : deps.pickDictionaryWord(user.userId, recentWords),
};

/**
 * Choose what to send, in layers.
 *
 * 1. the user's own vocabulary — always the most relevant thing we have;
 * 2. a curated preset, when the dictionary is empty or every word in it has
 *    already been sent inside the de-dup window;
 * 3. nothing, and the caller shows the empty-dictionary prompt.
 *
 * `recentWords` carries the rolling de-dup window plus the single last-sent
 * word, so no layer can repeat the previous notification even when the window
 * has rolled over — the failure a one-word dictionary would otherwise hit
 * every single time.
 */
async function pickWordForUser(
  user: NotificationUser,
  deps: SchedulerDeps,
  recentWords: string[],
): Promise<SuggestedWord | null> {
  const picker = WORD_PICKERS[user.notificationType] ?? pickFromDictionary;
  const fromDictionary = await picker(user, deps, recentWords);
  if (fromDictionary) return fromDictionary;

  logEvent("notification.dictionary_exhausted", { recentWordCount: recentWords.length });
  return deps.pickPresetWord(
    { userId: user.userId, nativeLang: user.nativeLang, learningLangs: user.learningLangs },
    recentWords,
  );
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
  // Eligible users have a valid timezone (invalid ones are filtered in getUsersForWindow);
  // derive the send hour from the current local time since there's no single configured time.
  let hour = 8;
  try {
    hour = Temporal.Now.zonedDateTimeISO(user.timezone).hour;
  } catch {
    // invalid timezone — keep default
  }

  const title = t("notifTitle", lang);
  const sourceLabel =
    word.source === "srs"
      ? t("notifWordFromDict", lang)
      : word.source === "preset"
        ? t("notifPresetWord", lang)
        : word.source === "contextual"
          ? t("notifTypeContextual", lang)
          : t("notifAiSuggested", lang);

  const translationLines = Object.entries(word.translations)
    .map(([, text]) => `  • ${text}`)
    .join("\n");

  const lines = [
    `${word.emoji} <b>${escapeHtml(word.original)}</b>`,
    `<i>${sourceLabel}</i>`,
    "",
    `${title}:`,
    translationLines,
  ];

  return {
    hour,
    word,
    message: lines.join("\n"),
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Process one hourly tick: find eligible users, pick words, send notifications.
 */
/**
 * Public seat for one tick. Opens the batch trace so every record the tick
 * emits — the user query, each delivery, the summary — is correlated, exactly
 * as a Telegram update is. Without this, a background failure has no thread to
 * pull: the scheduler runs with no ambient identity at all.
 */
export async function checkAndSend(sendFn: SendFn, deps: SchedulerDeps): Promise<{ sent: number; errors: number }> {
  return runWithTrace({ traceId: newTraceId(), source: "cron", jobName: "notifications" }, () =>
    runNotificationBatch(sendFn, deps),
  );
}

async function runNotificationBatch(sendFn: SendFn, deps: SchedulerDeps): Promise<{ sent: number; errors: number }> {
  const logger = getLogger();
  const batchTraceId = getTraceContext()?.traceId;
  const now = Temporal.Now.zonedDateTimeISO("UTC");
  const utcHour = now.hour;
  const utcMinute = now.minute;
  let sent = 0;
  let errors = 0;

  // Step 1: Get users whose local time matches their preferred notification window
  let users: NotificationUser[];
  try {
    users = await retryWithBackoff(() => deps.getUsersForWindow(utcHour, utcMinute), 3, 1000, "getUsersForWindow");
    logger.info({ utcHour, utcMinute, userCount: users.length }, "Users fetched for notification window");
    if (users.length > 0) {
      for (const u of users) {
        logger.info(
          {
            userId: u.userId,
            timezone: u.timezone,
            notificationTimes: u.notificationTimes,
            notificationEnabled: u.notificationEnabled,
          },
          "Eligible user details",
        );
      }
    }
  } catch (err) {
    logger.error({ err, utcHour, utcMinute }, "Failed to query users for notification window after retries");
    return { sent: 0, errors: 1 };
  }

  if (users.length === 0) {
    logger.info({ utcHour, utcMinute }, "No users eligible for notification at this time");
    return { sent: 0, errors: 0 };
  }

  logger.info({ utcHour, utcMinute, userCount: users.length }, "Processing notification batch");

  // Step 2: For each user, pick a word and send. Each delivery gets its own
  // trace linked to the batch, so one user's failed notification is followable
  // end to end without wading through the whole tick.
  for (const user of users) {
    const outcome = await runWithTrace(
      {
        traceId: newTraceId(),
        source: "cron",
        jobName: "notifications",
        userId: user.userId,
        ...(batchTraceId !== undefined && { parentTraceId: batchTraceId }),
      },
      async (): Promise<"sent" | "error" | "skipped"> => {
        try {
          logger.info({ userId: user.userId }, "Processing user");
          const since = new Date(Date.now() - DEDUP_WINDOW_MS);
          const windowWords = await retryWithBackoff(
            () => deps.getSentWordsSince(user.userId, since),
            2,
            500,
            "getSentWordsSince",
          );
          // Age-independent: guarantees "never the same word twice running"
          // even after the previous send has aged out of the rolling window —
          // the case a one-word dictionary would otherwise hit every time.
          const lastSent = await deps.getLastSentWord(user.userId).catch(() => null);
          const recentWords = lastSent && !windowWords.includes(lastSent) ? [...windowWords, lastSent] : windowWords;
          const word = await pickWordForUser(user, deps, recentWords);
          if (!word) {
            logger.info({ userId: user.userId }, "No word picked — sending empty dictionary prompt");
            await deps.sendDictionaryEmptyPrompt(user.userId, user.interfaceLang);
            return "skipped";
          }

          logger.info({ userId: user.userId, word: word.original }, "Word picked, sending notification");
          const payload = buildNotificationPayload(user, word, deps.t);
          await sendWithRetry(sendFn, user.userId, payload, deps.isUserBlocked);

          await retryWithBackoff(
            () => deps.recordSentWord(user.userId, word.original, word.source ?? "suggested"),
            2,
            500,
            "recordSentWord",
          );
          logNotificationSent({
            userId: user.userId,
            type: word.source ?? "suggested",
          });

          return "sent";
        } catch (err) {
          // The user blocked the bot (403): stop mailing them forever — disable
          // their notifications instead of logging an error every batch (T14).
          if (deps.isUserBlocked?.(err)) {
            logger.warn({ userId: user.userId }, "User blocked the bot — disabling notifications");
            try {
              await deps.disableNotifications(user.userId);
            } catch (disableErr) {
              logger.error(
                { err: disableErr, userId: user.userId },
                "Failed to disable notifications for blocked user",
              );
            }
          } else {
            // Rule: log and continue — never stop the scheduler
            logger.error({ err, userId: user.userId }, "Failed to send notification — continuing");
          }
          return "error";
        }
      },
    );
    if (outcome === "sent") sent++;
    else if (outcome === "error") errors++;
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
  return runWithTrace({ traceId: newTraceId(), source: "cron", jobName: "re_engagement" }, () =>
    runInactiveUserSweep(reEngagementSendFn, deps),
  );
}

async function runInactiveUserSweep(
  reEngagementSendFn: ReEngagementSendFn,
  deps: SchedulerDeps,
): Promise<{ processed: number; errors: number }> {
  const logger = getLogger();
  const batchTraceId = getTraceContext()?.traceId;
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
    const ok = await runWithTrace(
      {
        traceId: newTraceId(),
        source: "cron",
        jobName: "re_engagement",
        userId: user.userId,
        ...(batchTraceId !== undefined && { parentTraceId: batchTraceId }),
      },
      async (): Promise<boolean> => {
        try {
          const message = deps.t("notifPaused", user.interfaceLang);
          await reEngagementSendFn(user.userId, message);
          await deps.disableNotifications(user.userId);
          logger.info({ userId: user.userId }, "Sent re-engagement message and disabled notifications");
          return true;
        } catch (err) {
          logger.error({ err, userId: user.userId }, "Failed to process inactive user — continuing");
          return false;
        }
      },
    );
    if (ok) processed++;
    else errors++;
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

  logger.info({}, "Starting notification scheduler (*/30 * * * *)");

  cronTask = cron.schedule("*/30 * * * *", async () => {
    const now = Temporal.Now.zonedDateTimeISO("UTC");
    logger.info({ utcHour: now.hour, utcMinute: now.minute }, "Scheduler tick");
    try {
      await checkAndSend(sendFn, deps);

      // Process inactive users once daily at midnight UTC
      if (now.hour === 0 && now.minute === 0) {
        await processInactiveUsers(reEngagementSendFn, deps);

        // Sweep expired subscriptions (renew or downgrade) in the same daily tick.
        if (deps.processSubscriptionRenewals) {
          const result = await deps.processSubscriptionRenewals();
          logger.info(result, "Processed subscription renewals");
        }
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

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
 * Carries data only. Rendering — including the language order the card is shown
 * in — belongs to the channel adapter, which derives it from the user's settings
 * at send time; see `apps/bot/src/notifications/notification.formatter.ts`.
 */
export function buildNotificationPayload(user: NotificationUser, word: SuggestedWord): NotificationPayload {
  // Eligible users have a valid timezone (invalid ones are filtered in getUsersForWindow);
  // derive the send hour from the current local time since there's no single configured time.
  let hour = 8;
  try {
    hour = Temporal.Now.zonedDateTimeISO(user.timezone).hour;
  } catch {
    // invalid timezone — keep default
  }

  return { hour, word };
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
  // The single default for the injected batch clock (deps.now). Tests own a
  // dedicated UTC slot through this seam; see SchedulerDeps.now for why
  // vi.setSystemTime cannot do the job. There is deliberately no second
  // fallback anywhere else — startScheduler's own Temporal.Now read is the cron
  // callback's, not this one's, and must not be threaded through deps.
  const now = deps.now?.() ?? Temporal.Now.zonedDateTimeISO("UTC");
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
          const payload = buildNotificationPayload(user, word);
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
 * How far back the lapse de-dup looks.
 *
 * The daily lane's 24-hour window is meaningless at a five-day cadence — every
 * previous card has aged out of it by the time the next one is due, so the
 * preset picker (which takes the FIRST unseen candidate, not a random one) would
 * hand the same headword to the same user forever. A year spans at least two
 * full passes through the thirty curated words of a single learning language,
 * while still bounding the query.
 */
const LAPSE_DEDUP_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Pick the word a lapsed subscriber gets: their own vocabulary first, the
 * curated presets when it has nothing left.
 *
 * Deliberately NOT `pickWordForUser`: that one honours `notificationType`, and
 * the `contextual` branch bills an AI generation per card. Spending that every
 * five days, indefinitely, on someone who may never return is not worth it —
 * the preset layer is served from the reviewed demo-card cache and costs
 * nothing. What a lapsed user needs is an interesting word, not their configured
 * flavour of one.
 *
 * The second attempt is the cycle restart. Once a year's worth of history covers
 * every curated candidate the picker returns null, and a user who has been away
 * that long would go silent at exactly the wrong moment; retrying with only the
 * previous card excluded starts the set over without ever repeating twice
 * running.
 */
async function pickLapsedWord(
  user: NotificationUser,
  deps: SchedulerDeps,
  seenWords: string[],
  lastSent: string | null,
): Promise<SuggestedWord | null> {
  const presetUser = { userId: user.userId, nativeLang: user.nativeLang, learningLangs: user.learningLangs };

  const fromDictionary = await deps.pickDictionaryWord(user.userId, seenWords);
  if (fromDictionary) return fromDictionary;

  const fromPresets = await deps.pickPresetWord(presetUser, seenWords);
  if (fromPresets) return fromPresets;

  logEvent("notification.lapse.cycle_restart", { seenWordCount: seenWords.length });
  return deps.pickPresetWord(presetUser, lastSent ? [lastSent] : []);
}

/**
 * Re-engagement sweep for lapsed users.
 *
 * A lapse changes what the bot sends, not whether it sends. Past the inactivity
 * threshold the per-slot cards stop and the user drops to one word per
 * re-engagement interval — a real card, not a text nudge, because a
 * curated word is the thing they subscribed to and the thing most likely to be
 * worth opening. It continues for as long as they stay away.
 *
 * Two designs were tried and discarded here, both worth not re-inventing. The
 * sweep first answered inactivity by switching `notification_enabled` off — but
 * that flag is a predicate of its own candidate query, so re-engagement fired
 * once per account and then selected nobody, forever. It then sent four plain-text
 * nudges and went quiet, which reached the people with an empty dictionary with
 * nothing but nagging, when the curated preset set exists precisely for them.
 */
export async function processLapsedUsers(
  sendFn: SendFn,
  reEngagementSendFn: ReEngagementSendFn,
  deps: SchedulerDeps,
): Promise<{ processed: number; errors: number }> {
  return runWithTrace({ traceId: newTraceId(), source: "cron", jobName: "re_engagement" }, () =>
    runLapsedUserSweep(sendFn, reEngagementSendFn, deps),
  );
}

async function runLapsedUserSweep(
  sendFn: SendFn,
  reEngagementSendFn: ReEngagementSendFn,
  deps: SchedulerDeps,
): Promise<{ processed: number; errors: number }> {
  const logger = getLogger();
  const batchTraceId = getTraceContext()?.traceId;
  let processed = 0;
  let errors = 0;

  let lapsedUsers: NotificationUser[];
  try {
    lapsedUsers = await deps.getUsersForReEngagement();
  } catch (err) {
    logger.error({ err }, "Failed to query lapsed users for re-engagement");
    return { processed: 0, errors: 1 };
  }

  if (lapsedUsers.length === 0) {
    return { processed: 0, errors: 0 };
  }

  logger.info({ count: lapsedUsers.length }, "Processing lapsed users for re-engagement");

  for (const user of lapsedUsers) {
    const ok = await runWithTrace(
      {
        traceId: newTraceId(),
        source: "cron",
        jobName: "re_engagement",
        userId: user.userId,
        ...(batchTraceId !== undefined && { parentTraceId: batchTraceId }),
      },
      async (): Promise<boolean> => {
        const cardNumber = user.reengagementCount + 1;
        try {
          const since = new Date(Date.now() - LAPSE_DEDUP_WINDOW_MS);
          const seenWords = await deps.getSentWordsSince(user.userId, since).catch(() => []);
          const lastSent = await deps.getLastSentWord(user.userId).catch(() => null);
          const word = await pickLapsedWord(user, deps, seenWords, lastSent);

          if (word) {
            await sendWithRetry(sendFn, user.userId, buildNotificationPayload(user, word), deps.isUserBlocked);
            await deps
              .recordSentWord(user.userId, word.original, word.source ?? "preset")
              .catch((err: unknown) =>
                logger.warn({ err, userId: user.userId }, "Failed to record re-engagement word"),
              );
            logNotificationSent({ userId: user.userId, type: word.source ?? "preset" });
          } else {
            // Every source came up empty — the user studies only languages with
            // no curated set. A plain invitation still beats silence.
            logEvent("notification.lapse.no_word", {}, "warn");
            await reEngagementSendFn(user.userId, deps.t("notifReEngagement", user.interfaceLang));
          }

          await deps.recordReEngagement(user.userId);
          logger.info(
            { userId: user.userId, cardNumber, word: word?.original ?? null, source: word?.source ?? null },
            "Sent re-engagement card",
          );
          return true;
        } catch (err) {
          // A blocked bot is permanent, and a lapsed user is exactly who is most
          // likely to have blocked it. Without this the cadence has no end
          // condition at all, so a blocked chat would be retried every five days
          // for as long as the row exists.
          if (deps.isUserBlocked?.(err)) {
            logger.warn({ userId: user.userId }, "Lapsed user blocked the bot — disabling notifications");
            try {
              await deps.disableNotifications(user.userId);
            } catch (disableErr) {
              logger.error(
                { err: disableErr, userId: user.userId },
                "Failed to disable notifications for blocked user",
              );
            }
          } else {
            logger.error({ err, userId: user.userId, cardNumber }, "Failed to send re-engagement card — continuing");
          }
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
 * Also sends lapsed subscribers their re-engagement card, checked once daily at
 * midnight UTC and paced by the lapse policy.
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

      // Re-engage lapsed users once daily at midnight UTC
      if (now.hour === 0 && now.minute === 0) {
        await processLapsedUsers(sendFn, reEngagementSendFn, deps);

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

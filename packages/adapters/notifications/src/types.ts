/**
 * Notification module types.
 *
 * Defines public types for notification scheduling, delivery,
 * and word suggestion payloads.
 */
import type { DictionaryContext, LanguageTranslationEntry, TopicMeta, TopicWord } from "@polyglot/core";

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

/**
 * Notification type — matches BRD §2.5 notification categories.
 * - 'suggested': AI-suggested word based on user's saved topics
 * - 'srs': Word from dictionary due for review according to SRS schedule
 * - 'both': Alternates between SRS and AI-suggested
 */
export type NotificationType = "suggested" | "srs" | "both";

/** Injected send function — the notifications module never imports the bot. */
export type SendFn = (telegramId: number, payload: NotificationPayload) => Promise<void>;

/** User data needed for notification scheduling and delivery. */
export interface UserForNotification {
  id: number;
  telegramId: number;
  timezone: string;
  nativeLang: string;
  learningLangs: string[];
}

/** Notification payload sent to the user. */
export interface NotificationPayload {
  /** The hour (0-23) at which this notification was scheduled in user's local time. */
  hour: number;
  word: SuggestedWord;
  message: string;
}

/** A word suggested in a notification, with translations per language. */
export interface SuggestedWord {
  original: string;
  emoji: string;
  translations: Record<string, string>; // lang code -> translation text
  /** Source of the word: 'srs' (from dictionary) or 'suggested' (AI topic). */
  source?: NotificationType;
  /** Wiktionary dictionary context for the suggested word (if available). */
  dictionaryContext?: DictionaryContext;
}

// ─────────────────────────────────────────────
// Vocabulary types (for pickDictionaryWord)
// ─────────────────────────────────────────────

/** A vocabulary entry with translations, as returned by getUserVocabulary. */
export interface VocabEntry {
  id: number;
  original: string;
  emoji: string | null;
  createdAt: Date;
  translations: Array<{
    targetLangId: number;
    text: string;
  }>;
}

// ─────────────────────────────────────────────
// Scheduler types
// ─────────────────────────────────────────────

/** User data returned by the DB notification repository for scheduling. */
export interface NotificationUser {
  userId: number;
  telegramId: number;
  interfaceLang: string;
  nativeLang: string;
  learningLangs: string[];
  timezone: string;
  notificationTime: string;
  notificationType: string;
}

/** Send function for re-engagement messages (plain text). */
export type ReEngagementSendFn = (telegramId: number, message: string) => Promise<void>;

// ─────────────────────────────────────────────
// Dependency injection
// ─────────────────────────────────────────────

/**
 * Dependencies injected into the notification service.
 * Keeps the adapter independent of concrete implementations.
 */
export interface NotificationServiceDeps {
  /** Get words for a builtin topic (cache-first, then AI batch). */
  getTopicWords: (topicId: string, sourceLang: string, targetLangs: string[]) => Promise<TopicWord[]>;

  /**
   * Regenerate a single language translation for a topic word.
   * Used for partial regeneration when a cached word is missing a language.
   * Optional — if not provided, words with missing languages are skipped.
   */
  regenerateTopicWord?: (
    topicId: string,
    original: string,
    sourceLang: string,
    targetLang: string,
  ) => Promise<LanguageTranslationEntry>;

  /** Get metadata for all built-in topics. */
  getBuiltinTopics: () => TopicMeta[];

  /** Get user's language settings for building the suggested word. */
  getUserSettings: (userId: number) => Promise<UserForNotification | null>;

  /** Get all vocabulary entries for a user (for pickDictionaryWord). */
  getUserVocabulary?: (userId: number) => Promise<VocabEntry[]>;

  /** Resolve language ID → language code. */
  getLangCode?: (langId: number) => string | undefined;
}

/**
 * Dependencies injected into the scheduler.
 * Separates scheduling concerns from word-picking concerns.
 */
export interface SchedulerDeps {
  /** Get users eligible for notification at the given UTC hour/minute. */
  getUsersForWindow: (hour: number, minute?: number) => Promise<NotificationUser[]>;

  /** Get users with notifications enabled but inactive for > INACTIVITY_DAYS. */
  getInactiveUsers: () => Promise<NotificationUser[]>;

  /** Disable notifications for a user (e.g., due to inactivity). */
  disableNotifications: (userId: number) => Promise<void>;

  /** Get recent sent words for a user (to avoid repeats). */
  getRecentSentWords: (userId: number, limit?: number) => Promise<string[]>;

  /** Record a sent word in history. */
  recordSentWord: (userId: number, original: string, source: string) => Promise<void>;

  /** Pick a word from AI topic suggestions. */
  pickSuggestedWord: (userId: number, recentWords?: string[]) => Promise<SuggestedWord | null>;

  /** Pick a word from user's dictionary (SRS review). */
  pickDictionaryWord: (userId: number, recentWords?: string[]) => Promise<SuggestedWord | null>;

  /** Get i18n text. */
  t: (key: string, lang: string, params?: Record<string, string>) => string;
}

/**
 * Notification module types.
 *
 * Defines public types for notification scheduling, delivery,
 * and word suggestion payloads.
 */
import type { DictionaryContext, GenerateObjectFn, NotificationType, NotificationUser } from "@polyglot/core";

export type { NotificationType, NotificationUser };

/** Injected send function — the notifications module never imports the bot. */
export type SendFn = (telegramId: number, payload: NotificationPayload) => Promise<void>;

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
  nativeMeaning?: string;
  translations: Record<string, string>; // lang code -> translation text
  /** Per-translation context (synonyms) for richer notification rendering. */
  translationDetails?: Record<string, TranslationBrief>;
  /** Source of the word: 'srs' (from dictionary). */
  source?: NotificationType;
  /** Wiktionary dictionary context for the suggested word (if available). */
  dictionaryContext?: DictionaryContext;
  /** Vocabulary entry ID (for reveal/delete actions in notifications). */
  entryId?: number;
}

/** Brief translation context for notification display. */
export interface TranslationBrief {
  synonyms: string[];
}

// ─────────────────────────────────────────────
// Vocabulary types (for pickDictionaryWord)
// ─────────────────────────────────────────────

/** A vocabulary entry with translations, as returned by getUserVocabulary. */
export interface VocabEntry {
  id: number;
  original: string;
  emoji: string | null;
  nativeMeaning?: string | null;
  createdAt: Date;
  /**
   * Task 70 — true when the entry was translated on a "translate as written"
   * override for an unrecognized word. Such entries are never suggested in
   * notifications/SRS picks.
   */
  unverified?: boolean;
  translations: Array<{
    targetLangId: number;
    text: string;
    synonyms?: string[];
  }>;
}

// ─────────────────────────────────────────────
// Scheduler types
// ─────────────────────────────────────────────

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
  /** Get all vocabulary entries for a user (for pickDictionaryWord). */
  getUserVocabulary?: (userId: number) => Promise<VocabEntry[]>;

  /** Resolve language ID → language code. */
  getLangCode?: (langId: number) => string | undefined;

  /** Generate typed object via AI (for contextual notifications). */
  generateObject?: GenerateObjectFn;

  /** AI model to use for contextual generation. */
  contextualModel?: string;

  /**
   * Translate an entry that has no translations yet (lazy/JIT translation).
   * Called by pickDictionaryWord when it encounters a saved entry with 0 translations.
   * Returns updated translations if successful, null to skip the entry.
   */
  translateEntry?: (
    userId: number,
    entryId: number,
  ) => Promise<Array<{ targetLangId: number; text: string; synonyms?: string[] }> | null>;
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

  /** Get words sent to a user since the given instant (rolling de-dup window). */
  getSentWordsSince: (userId: number, since: Date) => Promise<string[]>;

  /** Record a sent word in history. */
  recordSentWord: (userId: number, original: string, source: string) => Promise<void>;

  /** Pick a word from user's dictionary (SRS review). */
  pickDictionaryWord: (userId: number, recentWords?: string[]) => Promise<SuggestedWord | null>;

  /** Generate a contextual sentence with translations (for 'contextual' type). */
  pickContextualWord: (
    userId: number,
    context: string,
    langs: { nativeLang: string; learningLangs: string[] },
    recentWords?: string[],
  ) => Promise<SuggestedWord | null>;

  /** Send a prompt when user has no dictionary words at notification time. */
  sendDictionaryEmptyPrompt: (telegramId: number, lang: string) => Promise<void>;

  /** Get i18n text. */
  t: (key: string, lang: string, params?: Record<string, string>) => string;

  /**
   * Classify a send error as a permanent "user blocked the bot" failure
   * (Telegram 403). When it returns true the scheduler stops retrying and
   * disables that user's notifications instead of retrying forever. Optional;
   * defaults to treating every error as transient (retryable). Fable T14.
   */
  isUserBlocked?: (err: unknown) => boolean;
}

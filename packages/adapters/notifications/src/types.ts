/**
 * Notification module types.
 *
 * Defines public types for notification scheduling, delivery,
 * and word suggestion payloads.
 */
import type {
  DictionaryContext,
  LanguageTranslationEntry,
  TopicMeta,
  TopicWord,
} from "@polyglot/core";

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

/** Injected send function — the notifications module never imports the bot. */
export type SendFn = (
  telegramId: number,
  payload: NotificationPayload,
) => Promise<void>;

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
  type: "morning" | "evening";
  word: SuggestedWord;
  message: string;
}

/** A word suggested in a notification, with translations per language. */
export interface SuggestedWord {
  original: string;
  emoji: string;
  translations: Record<string, string>; // lang code -> translation text
  /** Wiktionary dictionary context for the suggested word (if available). */
  dictionaryContext?: DictionaryContext;
}

// ─────────────────────────────────────────────
// Dependency injection
// ─────────────────────────────────────────────

/**
 * Dependencies injected into the notification service.
 * Keeps the adapter independent of concrete implementations.
 */
export interface NotificationServiceDeps {
  /** Get words for a builtin topic (cache-first, then AI batch). */
  getTopicWords: (
    topicId: string,
    sourceLang: string,
    targetLangs: string[],
  ) => Promise<TopicWord[]>;

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

  /**
   * Look up Wiktionary dictionary context for a word.
   * Returns null if no context found.
   * Optional — if not provided, suggested words won't include dictionary context.
   */
  lookupDictionaryContext?: (
    word: string,
    langCode: string,
  ) => Promise<DictionaryContext | null>;
}

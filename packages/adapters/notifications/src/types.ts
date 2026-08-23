/**
 * Notification module types.
 *
 * Defines public types for notification scheduling, delivery,
 * and word suggestion payloads.
 */
import type { DictionaryContext, GenerateObjectFn, NotificationType, NotificationUser } from "@polyglot/core";

export type { NotificationType, NotificationUser };

/**
 * Injected send function — the notifications module never imports the bot.
 * Takes the neutral `userId` (Fable T24/A1); the channel adapter resolves the
 * external delivery id via the identity port before hitting the channel API.
 */
export type SendFn = (userId: number, payload: NotificationPayload) => Promise<void>;

/** Notification payload sent to the user. */
export interface NotificationPayload {
  /** The hour (0-23) at which this notification was scheduled in user's local time. */
  hour: number;
  word: SuggestedWord;
}

/**
 * Where a suggested word came from. Deliberately wider than
 * {@link NotificationType}: `preset` is a fallback source the scheduler picks,
 * never a delivery type a user can select in settings.
 */
export type WordSource = NotificationType | "preset";

/** A word suggested in a notification, with translations per language. */
export interface SuggestedWord {
  original: string;
  emoji: string;
  nativeMeaning?: string;
  translations: Record<string, string>; // lang code -> translation text
  /** Per-translation context (synonyms) for richer notification rendering. */
  translationDetails?: Record<string, TranslationBrief>;
  /** Where the word came from — dictionary, AI context, or a curated preset. */
  source?: WordSource;
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
  /**
   * Notification feedback grade. "hard" words are weighted up in picks, "easy"
   * words are held back until every hard/normal word is exhausted. Absent =
   * unrated, weighted as "normal".
   */
  difficulty?: "hard" | "normal" | "easy";
  translations: Array<{
    targetLangId: number;
    text: string;
    synonyms?: string[];
  }>;
}

// ─────────────────────────────────────────────
// Scheduler types
// ─────────────────────────────────────────────

/** Send function for re-engagement messages (plain text). Takes the neutral `userId`. */
export type ReEngagementSendFn = (userId: number, message: string) => Promise<void>;

// ─────────────────────────────────────────────
// Dependency injection
// ─────────────────────────────────────────────

/**
 * Dependencies required to pick a word from the user's dictionary.
 *
 * The AI/vocabulary lookups here are genuinely required — a service wired
 * without them can never suggest a word, so they are non-optional and enforced
 * at compile time rather than silently short-circuiting at runtime (Fable
 * T29/A16). Truly optional enhancements stay optional.
 */
export interface DictionaryWordPickerDeps {
  /** Get all vocabulary entries for a user. */
  getUserVocabulary: (userId: number) => Promise<VocabEntry[]>;

  /** Resolve language ID → language code. */
  getLangCode: (langId: number) => string | undefined;

  /**
   * Translate an entry that has no translations yet (lazy/JIT translation).
   * Called by pickDictionaryWord when it encounters a saved entry with 0
   * translations. Optional enhancement — when absent, such entries are skipped.
   */
  translateEntry?: (
    userId: number,
    entryId: number,
  ) => Promise<Array<{ targetLangId: number; text: string; synonyms?: string[] }> | null>;
}

/**
 * Dependencies required to generate a contextual notification sentence.
 *
 * `generateObject` is required (Fable T29/A16); `contextualModel` stays optional
 * because it is a config value that may be unset (feature disabled).
 */
export interface ContextualWordPickerDeps {
  /** Generate typed object via AI (for contextual notifications). */
  generateObject: GenerateObjectFn;

  /** AI model to use for contextual generation. When unset, contextual picks are skipped. */
  contextualModel?: string;
}

/**
 * Dependencies for the curated-preset layer.
 *
 * The cache lookup is required — it is the free path and the reason the layer
 * is cheap. The JIT translation is optional: without it the layer simply covers
 * fewer (learning, native) pairs rather than failing.
 */
export interface PresetWordPickerDeps {
  /** A reviewed, pre-rendered card for this headword, or null when uncached. */
  findDemoCard: (
    sourceLang: string,
    nativeLang: string,
    headword: string,
  ) => Promise<{ emoji?: string; nativeMeaning?: string; translations: Record<string, string> } | null>;

  /** Translate a curated headword on demand when no reviewed card covers it. */
  translateHeadword?: (
    headword: string,
    sourceLang: string,
    nativeLang: string,
  ) => Promise<{ emoji?: string; nativeMeaning?: string; translations: Record<string, string> } | null>;
}

/**
 * Full notification service dependencies — the composition of the dictionary and
 * contextual picker deps. Keeps the adapter independent of concrete
 * implementations.
 */
export type NotificationServiceDeps = DictionaryWordPickerDeps & ContextualWordPickerDeps;

/**
 * Dependencies injected into the scheduler.
 * Separates scheduling concerns from word-picking concerns.
 */
export interface SchedulerDeps {
  /**
   * Pick a curated preset word for a user whose dictionary cannot supply one.
   * Returning null means this layer has nothing either, and the scheduler falls
   * through to the empty-dictionary prompt.
   */
  pickPresetWord: (
    user: { userId: number; nativeLang: string; learningLangs: string[] },
    recentWords?: string[],
  ) => Promise<SuggestedWord | null>;

  /**
   * The single most recently notified word, regardless of age. The rolling
   * de-dup window already covers the common case; this closes the gap where a
   * user with one dictionary word would otherwise receive it twice running
   * once the window rolls over.
   */
  getLastSentWord: (userId: number) => Promise<string | null>;

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

  /** Send a prompt when user has no dictionary words at notification time. Takes the neutral `userId`. */
  sendDictionaryEmptyPrompt: (userId: number, lang: string) => Promise<void>;

  /** Get i18n text. */
  t: (key: string, lang: string, params?: Record<string, string>) => string;

  /**
   * Classify a send error as a permanent "user blocked the bot" failure
   * (Telegram 403). When it returns true the scheduler stops retrying and
   * disables that user's notifications instead of retrying forever. Optional;
   * defaults to treating every error as transient (retryable). Fable T14.
   */
  isUserBlocked?: (err: unknown) => boolean;
  /**
   * Sweep expired subscriptions (verify renewal, extend or downgrade). Optional —
   * runs in the daily 00:00 UTC tick when provided. Returns per-run counts.
   */
  processSubscriptionRenewals?: () => Promise<{ renewed: number; expired: number }>;

  /**
   * Injectable UTC clock for the batch window. Defaults to `Temporal.Now`.
   *
   * This seam exists because **`vi.setSystemTime` cannot control which window a
   * batch believes it is in**: `vi.useFakeTimers({ toFake: ["Date"] })` patches
   * `Date` only, and both `runNotificationBatch` and `getLocalMinutes` read
   * `Temporal.Now`, which is unaffected (verified by probe on Node v26). Without
   * an injected clock a delivery test would pass or fail according to the wall
   * clock hour it happens to run at. Do not delete this in favour of fake timers.
   *
   * Note it does NOT make DST deterministic — `{hour, minute}` discards the date,
   * and `getLocalMinutes` deliberately resolves the offset against *today*. Assert
   * DST/offset cases against `getUsersForWindow(h, m)` directly, not through the batch.
   */
  now?: () => { hour: number; minute: number };
}

import type { TranslateOutput } from "@polyglot/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import type { SourceUsage, VocabTranslationDetails, VocabularySource } from "./repositories/vocabulary.repository.js";

// ─────────────────────────────────────────────
// Languages — single source of truth for all language metadata
// ─────────────────────────────────────────────
export const languages = pgTable(
  "languages",
  {
    id: serial("id").primaryKey(),
    /** ISO 639-1 code: "en", "ru", "cs" */
    code: text("code").notNull().unique(),
    /** English name: "English", "Russian", "Czech" */
    name: text("name").notNull(),
    /** Native/autonym name: "English", "Русский", "Čeština" */
    nativeName: text("native_name"),
    /** Emoji flag: "🇬🇧", "🇷🇺", "🇨🇿" */
    flag: text("flag"),
    /** Available in bot UI as interface/learning language */
    isSupported: boolean("is_supported").default(false).notNull(),
    /** Localized names: {"ru": "Английский", "cs": "Angličtina"} */
    localizedNames: jsonb("localized_names").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex("languages_code_idx").on(t.code)],
);

// ─────────────────────────────────────────────
// Word context — offline dictionary data
// Imported from kaikki.org JSONL extracts
// ─────────────────────────────────────────────
export const wordContext = pgTable(
  "word_context",
  {
    id: serial("id").primaryKey(),
    word: text("word").notNull(),
    languageId: integer("language_id")
      .references(() => languages.id)
      .notNull(),
    pos: text("pos").notNull(),
    forms: text("forms").array().default([]),
    formTags: text("form_tags").array().default([]),
    glosses: text("glosses").array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("word_context_word_lang_idx").on(t.word, t.languageId),
    index("word_context_lang_idx").on(t.languageId),
    // Hot preflight path (Fable T17): case-insensitive exact lookup done via
    // `lower(word) = lower($1)` instead of ILIKE (which can't use a btree),
    // backed by this functional index — turns a seq scan on every translation
    // into an index lookup.
    index("word_context_lower_word_idx").on(sql`lower(${t.word})`),
    // GIN index for `arrayContains(forms, [word])` — the known-form lookup on
    // the same hot path; a plain btree cannot serve array containment.
    index("word_context_forms_gin_idx").using("gin", t.forms),
  ],
);

// ─────────────────────────────────────────────
// Dictionary lookup logs — audit trail for word_context lookups
// ─────────────────────────────────────────────
export const dictionaryLookupLogs = pgTable(
  "dictionary_lookup_logs",
  {
    id: serial("id").primaryKey(),
    lookupInput: text("lookup_input").notNull(),
    normalizedInput: text("normalized_input").notNull(),
    langCode: text("lang_code").notNull(),
    matched: boolean("matched").notNull(),
    matchCount: integer("match_count").default(0).notNull(),
    matchedWord: text("matched_word"),
    matchType: text("match_type"),
    matchedPos: text("matched_pos"),
    matchedGlosses: text("matched_glosses").array().default([]),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("dictionary_lookup_logs_created_at_idx").on(t.createdAt),
    index("dictionary_lookup_logs_lang_created_idx").on(t.langCode, t.createdAt),
    index("dictionary_lookup_logs_matched_created_idx").on(t.matched, t.createdAt),
  ],
);

export type DictionaryLookupLog = typeof dictionaryLookupLogs.$inferSelect;

// ─────────────────────────────────────────────
// User identification — who the user is
// ─────────────────────────────────────────────
export const audienceGroupEnum = pgEnum("audience_group", ["admin", "tester", "product"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).unique().notNull(),
  username: text("username"),
  audienceGroup: audienceGroupEnum("audience_group").default("product").notNull(),
  subscriptionPlan: text("subscription_plan").default("free").notNull(),
  onboardingStep: integer("onboarding_step").default(0).notNull(),
  onboarded: boolean("onboarded").default(false).notNull(),
  /**
   * When onboarding was completed (Task 72, slice 8). Nullable on purpose: rows
   * that finished onboarding before this column existed carry NULL and are
   * never backfilled, because there is no way to reconstruct the instant. Every
   * "since onboarding" query must therefore treat NULL as *not eligible* — a
   * months-old account has no D+1 window left, and nudging it would be spam.
   */
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AudienceGroup = (typeof audienceGroupEnum.enumValues)[number];

// ─────────────────────────────────────────────
// Channel identities (multichannel foundation, Fable T24/A1)
// Maps the neutral domain `userId` to a per-channel external id. The domain
// operates on `userId`; each delivery channel (telegram, …) resolves its own
// `externalId` here instead of the domain depending on `users.telegram_id`.
// ─────────────────────────────────────────────
export const identities = pgTable(
  "identities",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    channel: text("channel").notNull(),
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("identities_channel_external_id_idx").on(t.channel, t.externalId),
    index("identities_user_id_idx").on(t.userId),
  ],
);

// ─────────────────────────────────────────────
// User language settings (1-to-1 with users)
// ─────────────────────────────────────────────
export const userLanguageSettings = pgTable("user_language_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .unique()
    .notNull(),
  interfaceLang: text("interface_lang").notNull(),
  nativeLang: text("native_lang").notNull(),
  learningLangs: text("learning_langs").array().notNull().default([]),
  timezone: text("timezone").default("UTC").notNull(),
  /** Current bot mode: "translate" | "mentor" | "quiz" (extensible) */
  activeMode: text("active_mode").default("translate").notNull(),
  /** Last explicitly selected source language code (nullable = auto-detect / never selected).
   *  Survives bot restarts; session is the primary source during a session. */
  lastSourceLang: text("last_source_lang"),
  /** Whether daily word notifications are enabled */
  notificationEnabled: boolean("notification_enabled").default(false).notNull(),
  /**
   * Preferred notification times in user's local time ("HH:MM" each). Up to 12.
   *
   * **Empty = not configured**, and the default is empty precisely so that state
   * is representable. A non-empty default would make "never opened settings"
   * indistinguishable from "deliberately picked this hour", which is what forces
   * a guess later. The schedule is filled in when the user turns notifications
   * on, from the admin-managed `notifications.defaultTime`.
   */
  notificationTimes: text("notification_times").array().notNull().default([]),
  /** Notification word source: 'suggested' (AI) | 'srs' (dictionary review) | 'contextual' (AI + user context) */
  notificationType: text("notification_type").$type<"suggested" | "srs" | "contextual">().default("srs").notNull(),
  /** User-provided context for AI-generated contextual notifications (e.g., "preparing for job interview") */
  notificationContext: text("notification_context"),
  /** Last bot interaction timestamp — used for 14-day inactivity pause */
  lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
  isActive: boolean("is_active").default(true).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────
// Vocabulary entries — normalized word/phrase per user
// (replaces monolithic words.content JSONB)
// ─────────────────────────────────────────────
export const vocabularyEntries = pgTable(
  "vocabulary_entries",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    original: text("original").notNull(),
    sourceLangId: integer("source_lang_id")
      .references(() => languages.id)
      .notNull(),
    inputType: text("input_type").$type<"word" | "phrase" | "sentence">().default("word").notNull(),
    emoji: text("emoji"),
    nativeMeaning: text("native_meaning"),
    sourceUsage: jsonb("source_usage").$type<SourceUsage>(),
    source: jsonb("source").$type<VocabularySource>(),
    /**
     * Task 70 — set when the source headword was not recognized as a real word
     * but translated anyway on the user's "translate as written" override.
     * Unverified entries are excluded from daily notifications and SRS picks.
     */
    unverified: boolean("unverified").default(false).notNull(),
    /** Notification feedback grade ('hard' | 'normal' | 'easy'); null = unrated, weighted as normal. */
    difficulty: text("difficulty").$type<"hard" | "normal" | "easy">(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("ve_user_id_idx").on(t.userId),
    uniqueIndex("ve_user_original_sourcelang_idx").on(t.userId, t.original, t.sourceLangId),
  ],
);

// ─────────────────────────────────────────────
// Vocabulary dictionaries — user-owned collections of saved entries
// ─────────────────────────────────────────────
export const vocabularyDictionaries = pgTable(
  "vocabulary_dictionaries",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("vd_user_id_idx").on(t.userId), uniqueIndex("vd_user_name_idx").on(t.userId, t.name)],
);

export const vocabularyDictionaryEntries = pgTable(
  "vocabulary_dictionary_entries",
  {
    dictionaryId: integer("dictionary_id")
      .references(() => vocabularyDictionaries.id, { onDelete: "cascade" })
      .notNull(),
    entryId: integer("entry_id")
      .references(() => vocabularyEntries.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.dictionaryId, t.entryId] }), index("vde_entry_id_idx").on(t.entryId)],
);

// ─────────────────────────────────────────────
// Vocabulary translations — one row per target language per entry
// ─────────────────────────────────────────────
export const vocabularyTranslations = pgTable(
  "vocabulary_translations",
  {
    id: serial("id").primaryKey(),
    entryId: integer("entry_id")
      .references(() => vocabularyEntries.id, { onDelete: "cascade" })
      .notNull(),
    targetLangId: integer("target_lang_id")
      .references(() => languages.id)
      .notNull(),
    text: text("text").notNull(),
    expressionType: text("expression_type"),
    equivalentNote: text("equivalent_note"),
    usageNote: text("usage_note"),
    connotationWarning: text("connotation_warning"),
    details: jsonb("details").$type<VocabTranslationDetails>(),
    /** SM-2 ease factor. Default 2.5 follows the standard initial value. */
    srsEaseFactor: real("srs_ease_factor").default(2.5).notNull(),
    /** Current SM-2 interval in days. 0 means the card has not been reviewed yet. */
    srsInterval: integer("srs_interval").default(0).notNull(),
    /** Next scheduled review date. NULL means unscheduled legacy row and is treated as due. */
    srsDueDate: timestamp("srs_due_date", { withTimezone: true }),
    /** Number of SRS reviews completed for this translation row. */
    srsReviewCount: integer("srs_review_count").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("vt_entry_id_idx").on(t.entryId),
    index("vt_target_lang_idx").on(t.targetLangId),
    index("vt_srs_due_idx").on(t.srsDueDate),
    uniqueIndex("vt_entry_lang_idx").on(t.entryId, t.targetLangId),
  ],
);

// ─────────────────────────────────────────────
// Word review log — tracks flashcard, notification, quiz reviews
// Required for 'least_reviewed' strategy and future SRS scheduling
// ─────────────────────────────────────────────
export const wordReviewLog = pgTable(
  "word_review_log",
  {
    id: serial("id").primaryKey(),
    /** References vocabulary_entries.id (not deprecated words table) */
    entryId: integer("entry_id")
      .references(() => vocabularyEntries.id, { onDelete: "cascade" })
      .notNull(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    /** What triggered this review: 'flashcard' | 'notification' | 'quiz' | 'srs' */
    sessionType: text("session_type").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("word_review_log_entry_idx").on(t.entryId),
    index("word_review_log_user_date_idx").on(t.userId, t.reviewedAt),
  ],
);

// ─────────────────────────────────────────────
// Translation request log — rate limiting & history
// ─────────────────────────────────────────────
export const translationRequests = pgTable(
  "translation_requests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    original: text("original").notNull(),
    sourceLangId: integer("source_lang_id").references(() => languages.id),
    creditCost: integer("credit_cost").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("translation_requests_user_idx").on(t.userId),
    index("translation_requests_user_date_idx").on(t.userId, t.createdAt),
  ],
);

// ─────────────────────────────────────────────
// Junction table: translation request → target languages
// Each request can have multiple target languages with FK integrity
// ─────────────────────────────────────────────
export const translationRequestTargetLangs = pgTable(
  "translation_request_target_langs",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .references(() => translationRequests.id, { onDelete: "cascade" })
      .notNull(),
    languageId: integer("language_id")
      .references(() => languages.id)
      .notNull(),
  },
  (t) => [
    index("tr_target_langs_request_idx").on(t.requestId),
    uniqueIndex("tr_target_langs_unique_idx").on(t.requestId, t.languageId),
  ],
);

// ─────────────────────────────────────────────
// User daily request counts — compact per-user/per-day aggregate (Fable T25/E5)
// Pre-aggregated counter so analytics/count readers never GROUP BY over the
// unboundedly-growing translation_requests ledger. Upserted whenever a request
// is logged; retention-pruned like the other telemetry tables.
// ─────────────────────────────────────────────
export const userDailyRequestCounts = pgTable(
  "user_daily_request_counts",
  {
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    /** Calendar day in UTC ("YYYY-MM-DD"). */
    day: date("day", { mode: "string" }).notNull(),
    /** Number of translation/AI requests logged for this user on this day. */
    requestCount: integer("request_count").default(0).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] }), index("udrc_day_idx").on(t.day)],
);

export type UserDailyRequestCount = typeof userDailyRequestCounts.$inferSelect;

// ─────────────────────────────────────────────
// Topic translation cache — shared across users
// Caches AI translations for topic dataset words
// per (topicId, original, sourceLang, targetLang)
// ─────────────────────────────────────────────
export const topicTranslationCache = pgTable(
  "topic_translation_cache",
  {
    id: serial("id").primaryKey(),
    topicId: text("topic_id").notNull(),
    original: text("original").notNull(),
    sourceLang: text("source_lang").notNull(),
    targetLang: text("target_lang").notNull(),
    content: jsonb("content").notNull(),
    isValid: boolean("is_valid").default(true).notNull(),
    invalidReason: text("invalid_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("topic_cache_unique_idx").on(t.topicId, t.original, t.sourceLang, t.targetLang),
    index("topic_cache_lookup_idx").on(t.topicId, t.sourceLang, t.targetLang),
  ],
);

// ─────────────────────────────────────────────
// Onboarding demo cards — pre-rendered "hook" cards (Task 72)
// The headword list is the code-side source of truth
// (packages/core/src/modules/onboarding/hook-words.ts); this table caches the
// rendered card per (sourceLang, nativeLang, headword) so the onboarding demo
// costs no AI call on the tap path.
// ─────────────────────────────────────────────
export const onboardingDemoCards = pgTable(
  "onboarding_demo_cards",
  {
    id: serial("id").primaryKey(),
    /** Learning language the headword belongs to (ISO 639-1) */
    sourceLang: text("source_lang").notNull(),
    /** Native language the card was rendered for (ISO 639-1) */
    nativeLang: text("native_lang").notNull(),
    headword: text("headword").notNull(),
    /** Serialized TranslateOutput — the exact payload renderTranslation consumes */
    payload: jsonb("payload").$type<TranslateOutput>().notNull(),
    /** Ordering within the hook keyboard */
    sortOrder: integer("sort_order").default(0).notNull(),
    /** Reviewed and safe to show. Unreviewed cards are never served. */
    isActive: boolean("is_active").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("onboarding_demo_cards_key_idx").on(t.sourceLang, t.nativeLang, t.headword)],
);

export type OnboardingDemoCard = typeof onboardingDemoCards.$inferSelect;
export type NewOnboardingDemoCard = typeof onboardingDemoCards.$inferInsert;

// ─────────────────────────────────────────────
// User translation templates — customizable output fields
// 1-to-1 with users. Controls which sections appear in translation output.
// ─────────────────────────────────────────────
export const userTranslationTemplates = pgTable(
  "user_translation_templates",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .unique()
      .notNull(),
    /** User-given name for this template */
    name: text("name").notNull().default("Custom"),
    /** 2-3 synonyms per language toggle */
    synonyms: boolean("synonyms").notNull().default(true),
    /** 3 contextual example sentences toggle */
    examples: boolean("examples").notNull().default(true),
    /** Up to 2 alternative translation variants toggle */
    alternatives: boolean("alternatives").notNull().default(true),
    /** Idiomatic expression type + equivalent note toggle */
    equivalentNote: boolean("equivalent_note").notNull().default(true),
    /** Connotation warnings for dangerous meanings toggle */
    connotationWarning: boolean("connotation_warning").notNull().default(true),
    /** Constructional grammar breakdown for phrases/sentences toggle */
    grammarBreakdown: boolean("grammar_breakdown").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("user_translation_templates_user_id_idx").on(t.userId)],
);

// ─────────────────────────────────────────────
// Reported issues — user-submitted bugs, suggestions, and other issues
// ─────────────────────────────────────────────

export type IssueType = "bug" | "suggestion" | "other";
export type IssueStatus = "open" | "in_progress" | "resolved" | "rejected";

export const reportedIssues = pgTable(
  "reported_issues",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").$type<IssueType>().notNull(),
    description: text("description").notNull(),
    status: text("status").$type<IssueStatus>().default("open").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ri_user_id_idx").on(t.userId), index("ri_status_idx").on(t.status)],
);

export type ReportedIssue = typeof reportedIssues.$inferSelect;

// ─────────────────────────────────────────────
// Notification history — tracks words sent to users
// Prevents repeating the same word in recent notifications
// ─────────────────────────────────────────────
export const notificationHistory = pgTable(
  "notification_history",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    original: text("original").notNull(),
    source: text("source").notNull(), // 'srs' | 'suggested'
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("notif_hist_user_sent_idx").on(t.userId, t.sentAt)],
);

export type NotificationHistory = typeof notificationHistory.$inferSelect;

// ─────────────────────────────────────────────
// Release announcement deliveries — one successful send per release/user/group
// ─────────────────────────────────────────────
export const releaseAnnouncementDeliveries = pgTable(
  "release_announcement_deliveries",
  {
    releaseId: text("release_id").notNull(),
    audienceGroup: audienceGroupEnum("audience_group").notNull(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.releaseId, t.audienceGroup, t.userId] }),
    index("release_announcement_deliveries_user_idx").on(t.userId),
  ],
);

export type ReleaseAnnouncementDelivery = typeof releaseAnnouncementDeliveries.$inferSelect;

// ─────────────────────────────────────────────
// Bot sessions — grammY session storage
// Stores per-chat/user bot session state so interactions survive restarts.
// ─────────────────────────────────────────────
export const botSessions = pgTable(
  "bot_sessions",
  {
    key: text("key").primaryKey(),
    data: jsonb("data").$type<unknown>().notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("bot_sessions_updated_at_idx").on(t.updatedAt)],
);

export type BotSession = typeof botSessions.$inferSelect;

// ─────────────────────────────────────────────
// Admin roles
// ─────────────────────────────────────────────
export const adminRoleEnum = pgEnum("admin_role", ["superadmin", "admin"]);

// ─────────────────────────────────────────────
// Admin users — web panel authentication
// ─────────────────────────────────────────────
export const adminUsers = pgTable(
  "admin_users",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    /** bcrypt hash */
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    role: adminRoleEnum("role").default("admin").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("admin_users_email_idx").on(t.email)],
);

export type AdminUser = typeof adminUsers.$inferSelect;

// ─────────────────────────────────────────────
// System settings — generic key-value store (JSONB values)
// Covers: AI generation defaults, SRS params, notification defaults,
// feature flags, etc.
// ─────────────────────────────────────────────
export const systemSettings = pgTable("system_settings", {
  key: varchar("key", { length: 255 }).primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;

// ─────────────────────────────────────────────
// Rate limit plans — admin-configurable per-plan limits
// ─────────────────────────────────────────────
/** How a plan's video allowance is counted. `none` = video feature not available. */
export const videoWindowEnum = pgEnum("video_window", ["none", "lifetime", "monthly"]);

export const rateLimitPlans = pgTable("rate_limit_plans", {
  /** Plan name: "free", "plus", "pro", "unlimited" */
  name: varchar("name", { length: 50 }).primaryKey(),
  label: varchar("label", { length: 100 }).notNull(),
  /** Max top-level translations per calendar month (UTC). null = unlimited */
  translationLimit: integer("translation_limit"),
  /** Cost per single translation request */
  creditCost: integer("credit_cost").default(1).notNull(),
  /** Max video analyses allowed within `videoWindow`. null = unlimited */
  videoLimit: integer("video_limit"),
  /** Window the video allowance is measured over. `none` = feature disabled for this plan. */
  videoWindow: videoWindowEnum("video_window").default("none").notNull(),
  /**
   * Display price in US cents shown on the upgrade screen. `null` = not for sale
   * (the free plan). Deliberately NOT a billing price: real charges will pin an
   * immutable `plan_prices` version per subscription (tech-req 16 §4.1), so this
   * column only drives copy and is safe for an admin to edit at any time.
   */
  priceUsdCents: integer("price_usd_cents"),
  isActive: boolean("is_active").default(true).notNull(),
  /** Users are reassigned here when another plan is deleted. Exactly one default is expected. */
  isDefault: boolean("is_default").default(false).notNull(),
  /**
   * The AI model this plan's users are served by. `null` = use the globally
   * default model (`ai_models.is_default`). This replaced an implicit rule where a
   * plan's model was "the default model if the plan was allowed to use it,
   * otherwise the alphabetically first allowed model" — unreadable in the admin
   * panel and impossible to predict. Routing is now one explicit choice per plan.
   */
  aiModelId: varchar("ai_model_id", { length: 255 }).references(() => aiModels.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RateLimitPlan = typeof rateLimitPlans.$inferSelect;

// ─────────────────────────────────────────────
// AI request latency metrics — one row per AI adapter request
// ─────────────────────────────────────────────
export const aiRequestLatencies = pgTable(
  "ai_request_latencies",
  {
    id: serial("id").primaryKey(),
    /** OpenRouter model ID, e.g. "openai/gpt-4o" */
    modelId: varchar("model_id", { length: 255 }).notNull(),
    /** AI adapter method that produced the request */
    requestKind: text("request_kind").$type<"object" | "text" | "chat" | "speech">().notNull(),
    durationMs: integer("duration_ms").notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    costUsd: real("cost_usd").default(0).notNull(),
    success: boolean("success").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("ai_req_latency_model_date_idx").on(t.modelId, t.createdAt),
    index("ai_req_latency_created_at_idx").on(t.createdAt),
  ],
);

export type AIRequestLatency = typeof aiRequestLatencies.$inferSelect;

// ─────────────────────────────────────────────
// Translation request timing — segment-level performance metrics
// Tracks preflight, DB lookup, AI request, and total duration per request
// ─────────────────────────────────────────────
export const translationRequestTimings = pgTable(
  "translation_request_timings",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Request type: 'translate', 'regen', 'mistype-confirm' */
    requestType: text("request_type").notNull(),
    /** Preflight: settings lookup, language detection, rate limit check (ms) */
    preflightMs: integer("preflight_ms").notNull(),
    /** DB lookup: dictionary context, template lookup (ms) */
    dbLookupMs: integer("db_lookup_ms").notNull(),
    /** AI request: OpenRouter API call (ms) */
    aiRequestMs: integer("ai_request_ms").notNull(),
    /** Total end-to-end duration (ms) */
    totalMs: integer("total_ms").notNull(),
    /** OpenRouter model used */
    modelId: varchar("model_id", { length: 255 }),
    /** Source language code */
    sourceLang: text("source_lang"),
    /** Target language codes */
    targetLangs: text("target_langs").array(),
    /** Input classification: 'word', 'phrase', 'sentence' */
    inputType: text("input_type"),
    /** Whether the request succeeded */
    success: boolean("success").notNull(),
    /** Error message on failure */
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("trt_user_id_idx").on(t.userId),
    index("trt_created_at_idx").on(t.createdAt),
    index("trt_request_type_idx").on(t.requestType),
  ],
);

export type TranslationRequestTiming = typeof translationRequestTimings.$inferSelect;

// ─────────────────────────────────────────────
// Language detection events — mistype flow analytics (Task 58)
// Tracks when detection fails (warning shown) and user outcome (confirmed/cancelled)
// ─────────────────────────────────────────────
export const languageDetectionEvents = pgTable(
  "language_detection_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Event type: 'warning_shown', 'confirmed', 'cancelled' */
    eventType: text("event_type").notNull(),
    /** Input text that could not be detected */
    word: text("word").notNull(),
    /** Fallback source language used for the mistype flow */
    sourceLang: text("source_lang"),
    /** Fallback target languages */
    targetLangs: text("target_langs").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("lde_user_id_idx").on(t.userId),
    index("lde_created_at_idx").on(t.createdAt),
    index("lde_event_type_idx").on(t.eventType),
  ],
);

export type LanguageDetectionEvent = typeof languageDetectionEvents.$inferSelect;

// ─────────────────────────────────────────────
// AI models — admin-configurable model registry
// ─────────────────────────────────────────────
export const aiModels = pgTable("ai_models", {
  /** OpenRouter model ID, e.g. "openai/gpt-4o" */
  id: varchar("id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  provider: varchar("provider", { length: 100 }).notNull(),
  maxTokens: integer("max_tokens").notNull(),
  costPer1kInput: real("cost_per_1k_input").notNull(),
  costPer1kOutput: real("cost_per_1k_output").notNull(),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  /** Default cost fallback for unknown models */
  isDefault: boolean("is_default").default(false).notNull(),
  /**
   * The model the AI failover retries on when the primary (default) model fails.
   * Admin-managed here rather than hardcoded in the bot, so a bad fallback can be
   * swapped without a redeploy. At most one row carries it (see
   * `aiModelRepository.setFallback`).
   */
  isFallback: boolean("is_fallback").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AIModelRow = typeof aiModels.$inferSelect;

// ─────────────────────────────────────────────
// Plan feature access — which premium features each plan unlocks
// A junction gating feature keys per plan.
// ─────────────────────────────────────────────
export const planFeatureAccess = pgTable(
  "plan_feature_access",
  {
    planName: varchar("plan_name", { length: 50 })
      .notNull()
      .references(() => rateLimitPlans.name, { onDelete: "cascade" }),
    /** Feature key, e.g. "grammarBreakdown", "etymology", "grammarDetail" */
    featureKey: varchar("feature_key", { length: 100 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.planName, t.featureKey] }),
    index("plan_feature_access_feature_idx").on(t.featureKey),
  ],
);

export type PlanFeatureAccess = typeof planFeatureAccess.$inferSelect;

// ─────────────────────────────────────────────
// Translation output presets — admin-configurable
// ─────────────────────────────────────────────
export const translationPresets = pgTable("translation_presets", {
  name: varchar("name", { length: 100 }).primaryKey(),
  label: varchar("label", { length: 255 }).notNull(),
  config: jsonb("config")
    .$type<{
      synonyms: boolean;
      examples: boolean;
      alternatives: boolean;
      equivalentNote: boolean;
      connotationWarning: boolean;
    }>()
    .notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type TranslationPreset = typeof translationPresets.$inferSelect;

// ─────────────────────────────────────────────
// User learning languages — per-language proficiency level
// Extends the text[] learningLangs in userLanguageSettings with per-language metadata
// ─────────────────────────────────────────────
export const userLearningLanguages = pgTable(
  "user_learning_languages",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    languageCode: text("language_code").notNull(),
    /** CEFR proficiency level: A1, A2, B1, B2, C1, C2 */
    proficiencyLevel: text("proficiency_level").default("B1").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("ull_user_lang_idx").on(t.userId, t.languageCode), index("ull_user_id_idx").on(t.userId)],
);

export type UserLearningLanguage = typeof userLearningLanguages.$inferSelect;

// ─────────────────────────────────────────────
// Video vocabulary — YouTube video processing requests
// ─────────────────────────────────────────────
export const videoProcesses = pgTable(
  "video_processes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    /** YouTube video ID (e.g. "dQw4w9WgXcQ") */
    videoId: text("video_id").notNull(),
    videoUrl: text("video_url").notNull(),
    title: text("title"),
    durationSeconds: integer("duration_seconds"),
    /** Transcript language code (ISO 639-1) */
    language: text("language").notNull(),
    /** 'manual' | 'auto-generated' */
    transcriptType: text("transcript_type"),
    /** 'pending' | 'processing' | 'completed' | 'failed' */
    status: text("status").$type<"pending" | "processing" | "completed" | "failed">().default("pending").notNull(),
    errorMessage: text("error_message"),
    /**
     * The one free video offered from the onboarding suggestions (Task 72). Free
     * plan allowance is 3 *lifetime*, so spending one on a demo the user has not
     * yet seen the value of is a third of everything they get. Trial rows are
     * excluded from both usage counts; one per user, enforced by
     * `hasCompletedTrial`.
     */
    isTrial: boolean("is_trial").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("vp_user_id_idx").on(t.userId),
    index("vp_video_lang_idx").on(t.videoId, t.language),
    index("vp_user_status_idx").on(t.userId, t.status),
  ],
);

export type VideoProcess = typeof videoProcesses.$inferSelect;
export type VideoProcessStatus = "pending" | "processing" | "completed" | "failed";

// ─────────────────────────────────────────────
// Video phrases — extracted phrases from video transcripts
// ─────────────────────────────────────────────
export const videoPhrases = pgTable(
  "video_phrases",
  {
    id: serial("id").primaryKey(),
    videoProcessId: integer("video_process_id")
      .references(() => videoProcesses.id, { onDelete: "cascade" })
      .notNull(),
    phrase: text("phrase").notNull(),
    /** Translation of the phrase into user's native language */
    nativeTranslation: text("native_translation"),
    /** Emoji representing the phrase */
    emoji: text("emoji"),
    /** 'word' | 'idiom' | 'collocation' | 'phrasal_verb' */
    phraseType: text("phrase_type"),
    /** CEFR level: A1-C2 */
    level: text("level"),
    /** Sentence from transcript where the phrase appears */
    context: text("context"),
    /** Position in video (seconds) for deep link */
    timestampSeconds: integer("timestamp_seconds"),
    /** Learning value rank (1 = most useful) */
    sortOrder: integer("sort_order").notNull(),
    /** Set when user saves phrase to vocabulary dictionary */
    savedEntryId: integer("saved_entry_id").references(() => vocabularyEntries.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("vph_process_sort_idx").on(t.videoProcessId, t.sortOrder)],
);

export type VideoPhrase = typeof videoPhrases.$inferSelect;

// ─────────────────────────────────────────────
// Video transcript cache — shared across users
// Avoids re-fetching the same transcript from YouTube
// ─────────────────────────────────────────────
export const videoTranscriptCache = pgTable(
  "video_transcript_cache",
  {
    id: serial("id").primaryKey(),
    videoId: text("video_id").notNull(),
    language: text("language").notNull(),
    transcript: text("transcript").notNull(),
    /** 'manual' | 'auto-generated' */
    transcriptType: text("transcript_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("vtc_video_lang_idx").on(t.videoId, t.language)],
);

export type VideoTranscriptCache = typeof videoTranscriptCache.$inferSelect;

// ─────────────────────────────────────────────
// Subscriptions — recurring paid plan state (source of truth for lifecycle)
// users.subscriptionPlan stays the fast pointer read by the entitlements resolver.
// ─────────────────────────────────────────────
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    /** Plan the subscription grants: "plus" | "pro" (references rate_limit_plans.name) */
    plan: varchar("plan", { length: 50 })
      .notNull()
      .references(() => rateLimitPlans.name),
    /** 'active' | 'past_due' | 'canceled' | 'expired' */
    status: text("status").$type<"active" | "past_due" | "canceled" | "expired">().default("active").notNull(),
    /** Payment provider: "mock" now, "mollie" later */
    provider: varchar("provider", { length: 50 }).default("mock").notNull(),
    /** Provider-side subscription id (null for mock) */
    externalId: text("external_id"),
    /** When the currently-paid period ends; cron sweeps rows past this. */
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("subscriptions_user_idx").on(t.userId),
    index("subscriptions_status_period_idx").on(t.status, t.currentPeriodEnd),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionStatus = "active" | "past_due" | "canceled" | "expired";

// ─────────────────────────────────────────────
// TTS cache — synthesized pronunciations, keyed by Telegram file_id
// ─────────────────────────────────────────────
/**
 * One row per successfully synthesized pronunciation. The payload we keep is the
 * Telegram `file_id`, not the audio: re-sending a `file_id` costs neither an
 * OpenRouter call nor an upload, which is what makes the button free to press
 * repeatedly.
 *
 * The cache is deliberately global rather than per-user — a `file_id` is scoped to
 * the bot token, so any row is resendable to any chat this bot serves, and the same
 * word in the same language sounds the same for everyone.
 *
 * `modelId` and `voice` are part of the key so switching either in the admin
 * settings invalidates the old audio by construction instead of serving a voice the
 * admin just changed away from.
 */
export const ttsCache = pgTable(
  "tts_cache",
  {
    id: serial("id").primaryKey(),
    /** SHA-256 of the normalized text — keeps the unique index narrow and fixed-width. */
    textHash: varchar("text_hash", { length: 64 }).notNull(),
    /** The spoken text itself, kept for debugging and admin inspection. */
    text: text("text").notNull(),
    langCode: varchar("lang_code", { length: 16 }).notNull(),
    /** OpenRouter speech model that produced this audio. */
    modelId: varchar("model_id", { length: 255 }).notNull(),
    /** Voice used; empty string for models with no voice concept. */
    voice: varchar("voice", { length: 64 }).default("").notNull(),
    telegramFileId: text("telegram_file_id").notNull(),
    /** Characters billed for this synthesis — the unit OpenRouter charges on. */
    charCount: integer("char_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
    useCount: integer("use_count").default(1).notNull(),
  },
  (t) => [
    uniqueIndex("tts_cache_key_idx").on(t.textHash, t.langCode, t.modelId, t.voice),
    // Supports future least-recently-used eviction; nothing prunes yet by design.
    index("tts_cache_last_used_idx").on(t.lastUsedAt),
  ],
);

export type TtsCacheRow = typeof ttsCache.$inferSelect;

// ─────────────────────────────────────────────
// Word picker — curated "angles" on a language, authored in the admin panel
// and offered to the user as the first step in the main menu.
// ─────────────────────────────────────────────
export const wordPickerPresets = pgTable(
  "word_picker_presets",
  {
    id: serial("id").primaryKey(),
    /** Stable key the seeder matches on, so an admin-edited preset survives re-seeding. */
    slug: varchar("slug", { length: 64 }).notNull(),
    emoji: varchar("emoji", { length: 16 }).default("✨").notNull(),
    /** Shown when the user's interface language has no entry in `titleI18n`. */
    title: varchar("title", { length: 120 }).notNull(),
    /** Interface-language code → title. Partial by design; missing codes fall back to `title`. */
    titleI18n: jsonb("title_i18n").$type<Record<string, string>>().default({}).notNull(),
    /** The instruction handed to the model — the angle itself. */
    prompt: text("prompt").notNull(),
    /** Learning languages this angle is offered for; empty means every language. */
    learningLangs: text("learning_langs").array().default(sql`ARRAY[]::text[]`).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("wpp_slug_idx").on(t.slug), index("wpp_active_order_idx").on(t.isActive, t.sortOrder)],
);

export type WordPickerPreset = typeof wordPickerPresets.$inferSelect;

/** One generated set: a user tapped one angle for one learning language. */
export const wordPickerRuns = pgTable(
  "word_picker_runs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    /**
     * The angle this set came from. `set null` rather than cascade: deleting a
     * preset in the admin panel must not delete word sets users are still
     * browsing, which is why the title is snapshotted alongside it.
     */
    presetId: integer("preset_id").references(() => wordPickerPresets.id, { onDelete: "set null" }),
    /** Preset title as shown when the set was generated. */
    presetTitle: varchar("preset_title", { length: 120 }).notNull(),
    presetEmoji: varchar("preset_emoji", { length: 16 }).default("✨").notNull(),
    /** Learning language the set was generated in (ISO 639-1). */
    langCode: text("lang_code").notNull(),
    nativeLang: text("native_lang").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("wpr_user_preset_idx").on(t.userId, t.presetId, t.langCode)],
);

export type WordPickerRun = typeof wordPickerRuns.$inferSelect;

export const wordPickerItems = pgTable(
  "word_picker_items",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .references(() => wordPickerRuns.id, { onDelete: "cascade" })
      .notNull(),
    word: text("word").notNull(),
    nativeTranslation: text("native_translation").notNull(),
    emoji: varchar("emoji", { length: 16 }),
    /** 'word' | 'phrase' | 'idiom' | 'collocation' */
    itemType: text("item_type"),
    /** CEFR level: A1–C2 */
    level: varchar("level", { length: 8 }),
    /** Example sentence in the learning language, with its native translation. */
    exampleTarget: text("example_target"),
    exampleNative: text("example_native"),
    /** What the angle reveals about this item, in the learner's native language. */
    note: text("note"),
    sortOrder: integer("sort_order").notNull(),
    savedEntryId: integer("saved_entry_id").references(() => vocabularyEntries.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("wpi_run_sort_idx").on(t.runId, t.sortOrder)],
);

export type WordPickerItem = typeof wordPickerItems.$inferSelect;

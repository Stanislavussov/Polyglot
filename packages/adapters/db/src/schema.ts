import {
  bigint,
  boolean,
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
import type { VocabTranslationDetails } from "./repositories/vocabulary.repository.js";

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
    createdAt: timestamp("created_at").defaultNow(),
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
    formTags: text("form_tags").array().default([]),
    glosses: text("glosses").array().default([]),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("word_context_word_lang_idx").on(t.word, t.languageId),
    index("word_context_lang_idx").on(t.languageId),
  ],
);

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
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AudienceGroup = (typeof audienceGroupEnum.enumValues)[number];

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
  /** Preferred notification time in user's local time ("HH:MM", e.g. "08:00", "14:30"). Default 08:00. */
  notificationTime: text("notification_time").default("08:00").notNull(),
  /** Notification word source: 'suggested' (AI) | 'srs' (dictionary review) | 'contextual' (AI + user context) */
  notificationType: text("notification_type").$type<"suggested" | "srs" | "contextual">().default("srs").notNull(),
  /** User-provided context for AI-generated contextual notifications (e.g., "preparing for job interview") */
  notificationContext: text("notification_context"),
  /** Last bot interaction timestamp — used for 14-day inactivity pause */
  lastInteractionAt: timestamp("last_interaction_at"),
  isActive: boolean("is_active").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
    inputType: text("input_type").$type<"word" | "phrase">().default("word").notNull(),
    emoji: text("emoji"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("ve_user_id_idx").on(t.userId),
    uniqueIndex("ve_user_original_sourcelang_idx").on(t.userId, t.original, t.sourceLangId),
  ],
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
    transcription: text("transcription"),
    expressionType: text("expression_type"),
    equivalentNote: text("equivalent_note"),
    connotationWarning: text("connotation_warning"),
    details: jsonb("details").$type<VocabTranslationDetails>(),
    /** SM-2 ease factor. Default 2.5 follows the standard initial value. */
    srsEaseFactor: real("srs_ease_factor").default(2.5).notNull(),
    /** Current SM-2 interval in days. 0 means the card has not been reviewed yet. */
    srsInterval: integer("srs_interval").default(0).notNull(),
    /** Next scheduled review date. NULL means unscheduled legacy row and is treated as due. */
    srsDueDate: timestamp("srs_due_date"),
    /** Number of SRS reviews completed for this translation row. */
    srsReviewCount: integer("srs_review_count").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
    reviewedAt: timestamp("reviewed_at").defaultNow().notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("topic_cache_unique_idx").on(t.topicId, t.original, t.sourceLang, t.targetLang),
    index("topic_cache_lookup_idx").on(t.topicId, t.sourceLang, t.targetLang),
  ],
);

// ─────────────────────────────────────────────
// User translation templates — customizable output fields
// 1-to-1 with users. Controls which sections appear
// in translation output (transcription, synonyms, etc.)
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
    /** IPA transcription toggle */
    transcription: boolean("transcription").notNull().default(true),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
    sentAt: timestamp("sent_at").defaultNow().notNull(),
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
    deliveredAt: timestamp("delivered_at").defaultNow().notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
    lastLoginAt: timestamp("last_login_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("admin_users_email_idx").on(t.email)],
);

export type AdminUser = typeof adminUsers.$inferSelect;

// ─────────────────────────────────────────────
// System settings — generic key-value store (JSONB values)
// Covers: AI generation defaults, SRS params, notification defaults,
// transcription thresholds, feature flags, etc.
// ─────────────────────────────────────────────
export const systemSettings = pgTable("system_settings", {
  key: varchar("key", { length: 255 }).primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;

// ─────────────────────────────────────────────
// Rate limit plans — admin-configurable credit limits
// ─────────────────────────────────────────────
export const rateLimitPlans = pgTable("rate_limit_plans", {
  /** Plan name: "free", "plus", "pro", "unlimited" */
  name: varchar("name", { length: 50 }).primaryKey(),
  label: varchar("label", { length: 100 }).notNull(),
  /** Credits per daily window. null = unlimited */
  creditsPerDay: integer("credits_per_day"),
  /** Window size in ms (default 24h) */
  windowMs: integer("window_ms").default(86_400_000).notNull(),
  /** Cost per single translation request */
  creditCost: integer("credit_cost").default(1).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  /** Users are reassigned here when another plan is deleted. Exactly one default is expected. */
  isDefault: boolean("is_default").default(false).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
    requestKind: text("request_kind").$type<"object" | "text">().notNull(),
    durationMs: integer("duration_ms").notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    costUsd: real("cost_usd").default(0).notNull(),
    success: boolean("success").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("trt_user_id_idx").on(t.userId),
    index("trt_created_at_idx").on(t.createdAt),
    index("trt_request_type_idx").on(t.requestType),
  ],
);

export type TranslationRequestTiming = typeof translationRequestTimings.$inferSelect;

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
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AIModelRow = typeof aiModels.$inferSelect;

// ─────────────────────────────────────────────
// AI model access — which subscription plans can use each model
// ─────────────────────────────────────────────
export const aiModelPlanAccess = pgTable(
  "ai_model_plan_access",
  {
    modelId: varchar("model_id", { length: 255 })
      .notNull()
      .references(() => aiModels.id, { onDelete: "cascade" }),
    planName: varchar("plan_name", { length: 50 })
      .notNull()
      .references(() => rateLimitPlans.name, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.modelId, t.planName] }), index("ai_model_plan_access_plan_idx").on(t.planName)],
);

export type AIModelPlanAccess = typeof aiModelPlanAccess.$inferSelect;

// ─────────────────────────────────────────────
// Translation output presets — admin-configurable
// ─────────────────────────────────────────────
export const translationPresets = pgTable("translation_presets", {
  name: varchar("name", { length: 100 }).primaryKey(),
  label: varchar("label", { length: 255 }).notNull(),
  config: jsonb("config")
    .$type<{
      transcription: boolean;
      synonyms: boolean;
      examples: boolean;
      alternatives: boolean;
      equivalentNote: boolean;
      connotationWarning: boolean;
    }>()
    .notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TranslationPreset = typeof translationPresets.$inferSelect;

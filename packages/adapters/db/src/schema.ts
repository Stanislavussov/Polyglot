import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
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
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).unique().notNull(),
  username: text("username"),
  onboardingStep: integer("onboarding_step").default(0).notNull(),
  onboarded: boolean("onboarded").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  /** Preferred notification hour in user's local time (0-23). Default 8 (08:00). */
  notificationTime: text("notification_time").default("8").notNull(),
  /** Notification word source: 'suggested' (AI) | 'srs' (dictionary review) | 'both' (alternate) */
  notificationType: text("notification_type").$type<"suggested" | "srs" | "both">().default("both").notNull(),
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
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("vt_entry_id_idx").on(t.entryId),
    index("vt_target_lang_idx").on(t.targetLangId),
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

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
    /** ISO 639-3 code for franc detection: "eng", "rus", "ces" */
    iso3Code: text("iso3_code"),
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
  isActive: boolean("is_active").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─────────────────────────────────────────────
// Word in the user's personal dictionary
// ─────────────────────────────────────────────
export const words = pgTable(
  "words",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    original: text("original").notNull(),
    sourceLang: text("source_lang").notNull(),
    content: jsonb("content").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("words_user_id_idx").on(t.userId)],
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

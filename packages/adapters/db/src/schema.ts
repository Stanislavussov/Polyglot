import {
  pgTable,
  serial,
  bigint,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────
// Languages — normalized language codes
// ─────────────────────────────────────────────
export const languages = pgTable(
  "languages",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
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
    sourceLang: text("source_lang"),
    targetLangs: text("target_langs").array().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("translation_requests_user_idx").on(t.userId),
    index("translation_requests_user_date_idx").on(t.userId, t.createdAt),
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
    uniqueIndex("topic_cache_unique_idx").on(
      t.topicId,
      t.original,
      t.sourceLang,
      t.targetLang,
    ),
    index("topic_cache_lookup_idx").on(t.topicId, t.sourceLang, t.targetLang),
  ],
);

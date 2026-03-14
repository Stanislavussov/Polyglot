# DB Schema (Drizzle ORM)

```tsx
// src/db/schema.ts
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
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────
// User identification — who the user is
// ─────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).unique().notNull(),
  username: text("username"),
  onboardingStep: integer("onboarding_step").default(0).notNull(), // 0=not started, 1=native lang set, 2=learning langs set, 3=demo done
  onboarded: boolean("onboarded").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─────────────────────────────────────────────
// User language settings
// ─────────────────────────────────────────────
export const userLanguageSettings = pgTable("user_language_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .unique() // 1-to-1 with users
    .notNull(),
  interfaceLang: text("interface_lang").notNull(), // bot interface language, e.g. "en" | "ru"
  nativeLang: text("native_lang").notNull(), // native language for translations
  learningLangs: text("learning_langs").array().notNull().default([]), // languages being learned
  timezone: text("timezone").default("UTC").notNull(), // IANA timezone, e.g. "Europe/Prague"
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
    sourceLang: text("source_lang").notNull(), // detected language of the original input
    // Content JSONB — AI Response Schema per target language:
    // {
    //   "cs": {
    //     "language": "Czech",
    //     "cefr_level": "B1",
    //     "translation": "Hippokratovo slovo",
    //     "emoji": "🩺",
    //     "transcription": "[ˈhɪpokratovo ˈslovo]",
    //     "register": "neutral",
    //     "synonyms": [{ "word": "lékařský slib", "register": "professional" }],
    //     "examples": [{ "context": "formal", "target": "...", "native": "..." }]
    //   },
    //   "en": { ... }
    // }
    content: jsonb("content").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("words_user_id_idx").on(t.userId)],
);

// ─────────────────────────────────────────────
// Translation request log — rate limiting & history
// Tracks every AI translation request per user (Section 10: max N per day)
// ─────────────────────────────────────────────
export const translationRequests = pgTable(
  "translation_requests",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    original: text("original").notNull(), // text the user submitted
    sourceLang: text("source_lang"), // detected source language (nullable — AI may fail to detect)
    targetLangs: text("target_langs").array().notNull(), // user's learning langs at time of request
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("translation_requests_user_idx").on(t.userId),
    index("translation_requests_user_date_idx").on(t.userId, t.createdAt),
  ],
);


```

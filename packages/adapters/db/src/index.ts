import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };

export type Db = ReturnType<typeof createDb>;

let db: Db | null = null;
let client: postgres.Sql | null = null;

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  client = postgres(databaseUrl);
  return drizzle(client, { schema });
}

/** Returns a singleton Drizzle client connected to PostgreSQL. */
export function getDb(): Db {
  if (!db) {
    db = createDb();
  }
  return db;
}

/** Closes the connection pool. Call on graceful shutdown. */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}

export { createContextLookup } from "./context-lookup.js";
export type { CachedLanguage } from "./language-cache.js";
// Language cache — loaded from DB, serves all language metadata
export {
  getAllLangs,
  getLang,
  getLangDisplay,
  getLangFlag,
  getLangName,
  getLangNativeName,
  getSupportedLangs,
  isKnownLang,
  isLanguageCacheLoaded,
  loadLanguageCache,
  normalizeToIso1,
} from "./language-cache.js";
export type {
  Language,
  NewLanguage,
} from "./repositories/language.repository.js";
export { languageRepository } from "./repositories/language.repository.js";
export type {
  NewTopicTranslation,
  TopicTranslation,
} from "./repositories/topic.repository.js";
export { topicRepository } from "./repositories/topic.repository.js";
export type { TranslationRequestDTO } from "./repositories/translation-request.repository.js";
export { translationRequestRepository } from "./repositories/translation-request.repository.js";
export type {
  NewUser,
  NewUserLanguageSettings,
  User,
  UserLanguageSettings,
} from "./repositories/user.repository.js";
// Re-export repositories and types
export { MAX_LEARNING_LANGS, userRepository } from "./repositories/user.repository.js";
export type {
  CreateWordInput,
  NewWord,
  StoredLanguageTranslation,
  StoredWordContent,
  Word,
} from "./repositories/word.repository.js";
export { wordRepository } from "./repositories/word.repository.js";
export type {
  NewWordContext,
  WordContext,
} from "./repositories/word-context.repository.js";
export { wordContextRepository } from "./repositories/word-context.repository.js";

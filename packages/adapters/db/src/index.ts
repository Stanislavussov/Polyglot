import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };

export type Db = ReturnType<typeof createDb>;

let db: Db | null = null;
let client: postgres.Sql | null = null;

function createDb() {
  const databaseUrl = process.env["DATABASE_URL"];
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

// Re-export repositories and types
export { userRepository } from "./repositories/user.repository.js";
export type {
  User,
  NewUser,
  UserLanguageSettings,
  NewUserLanguageSettings,
} from "./repositories/user.repository.js";
export { wordRepository } from "./repositories/word.repository.js";
export type { Word, NewWord } from "./repositories/word.repository.js";
export { topicRepository } from "./repositories/topic.repository.js";
export type {
  TopicTranslation,
  NewTopicTranslation,
} from "./repositories/topic.repository.js";
export { languageRepository } from "./repositories/language.repository.js";
export type {
  Language,
  NewLanguage,
} from "./repositories/language.repository.js";
export { wordContextRepository } from "./repositories/word-context.repository.js";
export type {
  WordContext,
  NewWordContext,
} from "./repositories/word-context.repository.js";
export { createContextLookup } from "./context-lookup.js";

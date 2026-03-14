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

// Re-export repositories
export { userRepository } from "./repositories/user.repository.js";
export { wordRepository } from "./repositories/word.repository.js";

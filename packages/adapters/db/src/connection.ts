/**
 * Database connection singleton.
 *
 * Extracted from index.ts so that repositories and other internal
 * modules can import getDb/closeDb without going through the barrel
 * (which re-exports them, causing circular dependencies).
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

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

/** Lightweight liveness probe for readiness checks: throws if the DB is unreachable. */
export async function pingDatabase(): Promise<void> {
  await getDb().execute(sql`select 1`);
}

/** Closes the connection pool. Call on graceful shutdown. */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}

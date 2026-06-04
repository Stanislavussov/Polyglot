import { eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { botSessions } from "../schema.js";

const SESSION_VERSION = 1;

export interface StoredBotSession {
  key: string;
  data: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const botSessionRepository = {
  async get(key: string): Promise<StoredBotSession | null> {
    const db = getDb();
    const rows = await db.select().from(botSessions).where(eq(botSessions.key, key)).limit(1);
    return rows[0] ?? null;
  },

  async upsert(key: string, data: unknown): Promise<void> {
    const db = getDb();
    await db
      .insert(botSessions)
      .values({
        key,
        data,
        version: SESSION_VERSION,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: botSessions.key,
        set: {
          data,
          version: SESSION_VERSION,
          updatedAt: new Date(),
        },
      });
  },

  async delete(key: string): Promise<void> {
    const db = getDb();
    await db.delete(botSessions).where(eq(botSessions.key, key));
  },
};

export { SESSION_VERSION as BOT_SESSION_VERSION };

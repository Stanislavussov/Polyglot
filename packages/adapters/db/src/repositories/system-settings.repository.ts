import { eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { systemSettings } from "../schema.js";

export const systemSettingsRepository = {
  async get<T>(key: string): Promise<T | null> {
    const db = getDb();
    const rows = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
    if (rows.length === 0) return null;
    return rows[0]!.value as T;
  },

  async set<T>(key: string, value: T, description?: string): Promise<void> {
    const db = getDb();
    await db
      .insert(systemSettings)
      .values({ key, value: value as Record<string, unknown>, description, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: value as Record<string, unknown>, description, updatedAt: new Date() },
      });
  },

  async getAll(): Promise<Array<{ key: string; value: unknown; description: string | null }>> {
    const db = getDb();
    const rows = await db.select().from(systemSettings);
    return rows.map((r) => ({ key: r.key, value: r.value, description: r.description }));
  },

  async delete(key: string): Promise<void> {
    const db = getDb();
    await db.delete(systemSettings).where(eq(systemSettings.key, key));
  },
};

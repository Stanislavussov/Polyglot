import { eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { languages } from "../schema.js";

export type Language = typeof languages.$inferSelect;
export type NewLanguage = typeof languages.$inferInsert;

export const languageRepository = {
  /** Find a language by its ISO code (e.g. "ru", "en"). */
  async findByCode(code: string): Promise<Language | null> {
    const db = getDb();
    const rows = await db.select().from(languages).where(eq(languages.code, code)).limit(1);
    return rows[0] ?? null;
  },

  /** Create a new language record. */
  async create(data: NewLanguage): Promise<Language> {
    const db = getDb();
    const rows = await db.insert(languages).values(data).returning();
    return rows[0]!;
  },

  /** Get or create a language by code. Returns the language record. */
  async getOrCreate(code: string, name: string): Promise<Language> {
    const db = getDb();

    // Try insert with conflict handling
    const [inserted] = await db
      .insert(languages)
      .values({ code, name })
      .onConflictDoNothing({ target: languages.code })
      .returning();

    if (inserted) return inserted;

    // Already existed — fetch it
    const rows = await db.select().from(languages).where(eq(languages.code, code)).limit(1);
    return rows[0]!;
  },

  /** List all known languages. */
  async findAll(): Promise<Language[]> {
    const db = getDb();
    return db.select().from(languages);
  },
};

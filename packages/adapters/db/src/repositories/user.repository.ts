import { eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { userLanguageSettings, users } from "../schema.js";

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserLanguageSettings = typeof userLanguageSettings.$inferSelect;
export type NewUserLanguageSettings = typeof userLanguageSettings.$inferInsert;

/** Maximum number of learning languages per user (BRD §5, §12). */
export const MAX_LEARNING_LANGS = 4;

export const userRepository = {
  /** Find a user by their Telegram ID. */
  async findByTelegramId(telegramId: number): Promise<User | null> {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    return rows[0] ?? null;
  },

  /** Create a new user. */
  async create(data: NewUser): Promise<User> {
    const db = getDb();
    const rows = await db.insert(users).values(data).returning();
    return rows[0]!;
  },

  /** Update user language settings (upsert). Throws if learningLangs exceeds MAX_LEARNING_LANGS.
   *  NOTE: Does NOT overwrite `lastSourceLang` unless explicitly provided — prevents accidental erasure. */
  async updateSettings(
    userId: number,
    settings: Omit<NewUserLanguageSettings, "userId">,
  ): Promise<UserLanguageSettings> {
    if (settings.learningLangs && settings.learningLangs.length > MAX_LEARNING_LANGS) {
      throw new Error(`Maximum ${MAX_LEARNING_LANGS} learning languages allowed, got ${settings.learningLangs.length}`);
    }
    const db = getDb();

    const set: Record<string, unknown> = {
      interfaceLang: settings.interfaceLang,
      nativeLang: settings.nativeLang,
      learningLangs: settings.learningLangs,
      timezone: settings.timezone,
      activeMode: settings.activeMode,
      updatedAt: new Date(),
    };

    // Only overwrite lastSourceLang when explicitly provided (including null to clear it)
    if ("lastSourceLang" in settings) {
      set.lastSourceLang = settings.lastSourceLang;
    }

    const rows = await db
      .insert(userLanguageSettings)
      .values({ ...settings, userId })
      .onConflictDoUpdate({
        target: userLanguageSettings.userId,
        set,
      })
      .returning();
    return rows[0]!;
  },

  /** Update only the last explicitly selected source language (fire-and-forget friendly).
   *  Pass null to clear (e.g. on re-onboarding or when language becomes invalid). */
  async updateLastSourceLang(userId: number, lang: string | null): Promise<void> {
    const db = getDb();
    await db
      .update(userLanguageSettings)
      .set({ lastSourceLang: lang, updatedAt: new Date() })
      .where(eq(userLanguageSettings.userId, userId));
  },

  /** Update user's active mode (translate, mentor, quiz, etc.). */
  async updateActiveMode(userId: number, mode: string): Promise<UserLanguageSettings | null> {
    const db = getDb();
    const rows = await db
      .update(userLanguageSettings)
      .set({ activeMode: mode, updatedAt: new Date() })
      .where(eq(userLanguageSettings.userId, userId))
      .returning();
    return rows[0] ?? null;
  },

  /** Get user language settings by user ID. */
  async getSettings(userId: number): Promise<UserLanguageSettings | null> {
    const db = getDb();
    const rows = await db.select().from(userLanguageSettings).where(eq(userLanguageSettings.userId, userId)).limit(1);
    return rows[0] ?? null;
  },

  /** Update user's onboarding step. */
  async updateOnboardingStep(userId: number, step: number): Promise<User> {
    const db = getDb();
    const rows = await db.update(users).set({ onboardingStep: step }).where(eq(users.id, userId)).returning();
    return rows[0]!;
  },

  /** Mark user as onboarded (3-step flow per BRD §5). */
  async markOnboarded(userId: number): Promise<User> {
    const db = getDb();
    const rows = await db
      .update(users)
      .set({ onboarded: true, onboardingStep: 3 })
      .where(eq(users.id, userId))
      .returning();
    return rows[0]!;
  },
};

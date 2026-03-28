import { eq } from "drizzle-orm";
import { getDb } from "../index.js";
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

  /** Update user language settings (upsert). Throws if learningLangs exceeds MAX_LEARNING_LANGS. */
  async updateSettings(
    userId: number,
    settings: Omit<NewUserLanguageSettings, "userId">,
  ): Promise<UserLanguageSettings> {
    if (settings.learningLangs && settings.learningLangs.length > MAX_LEARNING_LANGS) {
      throw new Error(`Maximum ${MAX_LEARNING_LANGS} learning languages allowed, got ${settings.learningLangs.length}`);
    }
    const db = getDb();
    const rows = await db
      .insert(userLanguageSettings)
      .values({ ...settings, userId })
      .onConflictDoUpdate({
        target: userLanguageSettings.userId,
        set: {
          interfaceLang: settings.interfaceLang,
          nativeLang: settings.nativeLang,
          learningLangs: settings.learningLangs,
          timezone: settings.timezone,
          activeMode: settings.activeMode,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0]!;
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

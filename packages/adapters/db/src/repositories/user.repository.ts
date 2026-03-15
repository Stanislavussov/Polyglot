import { eq } from "drizzle-orm";
import { getDb } from "../index.js";
import { users, userLanguageSettings } from "../schema.js";

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserLanguageSettings = typeof userLanguageSettings.$inferSelect;
export type NewUserLanguageSettings = typeof userLanguageSettings.$inferInsert;

export const userRepository = {
  /** Find a user by their Telegram ID. */
  async findByTelegramId(telegramId: number): Promise<User | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);
    return rows[0] ?? null;
  },

  /** Create a new user. */
  async create(data: NewUser): Promise<User> {
    const db = getDb();
    const rows = await db.insert(users).values(data).returning();
    return rows[0]!;
  },

  /** Update user language settings (upsert). */
  async updateSettings(
    userId: number,
    settings: Omit<NewUserLanguageSettings, "userId">,
  ): Promise<UserLanguageSettings> {
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
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0]!;
  },

  /** Get user language settings by user ID. */
  async getSettings(userId: number): Promise<UserLanguageSettings | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userLanguageSettings)
      .where(eq(userLanguageSettings.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  },

  /** Update user's onboarding step. */
  async updateOnboardingStep(
    userId: number,
    step: number,
  ): Promise<User> {
    const db = getDb();
    const rows = await db
      .update(users)
      .set({ onboardingStep: step })
      .where(eq(users.id, userId))
      .returning();
    return rows[0]!;
  },

  /** Mark user as onboarded. */
  async markOnboarded(userId: number): Promise<User> {
    const db = getDb();
    const rows = await db
      .update(users)
      .set({ onboarded: true, onboardingStep: 4 })
      .where(eq(users.id, userId))
      .returning();
    return rows[0]!;
  },
};

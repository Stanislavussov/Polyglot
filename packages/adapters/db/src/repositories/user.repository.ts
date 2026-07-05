import type {
  AudienceGroup,
  NewUser,
  SubscriptionPlan,
  User,
  UserLanguageSettings,
  UserLearningLanguage,
} from "@polyglot/core";
import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { escapeLikePattern } from "../like-escape.js";
import { releaseAnnouncementDeliveries, userLanguageSettings, userLearningLanguages, users } from "../schema.js";

export type { AudienceGroup, NewUser, SubscriptionPlan, User, UserLanguageSettings };

/** Internal insert type for Drizzle — kept local to avoid leaking DB-specific inference. */
type InsertUserLanguageSettings = typeof userLanguageSettings.$inferInsert;

/** Maximum number of learning languages per user (BRD §5, §12). */
export const MAX_LEARNING_LANGS = 4;
export const AUDIENCE_GROUPS = ["admin", "tester", "product"] as const satisfies readonly AudienceGroup[];

export function isAudienceGroup(value: string): value is AudienceGroup {
  return AUDIENCE_GROUPS.includes(value as AudienceGroup);
}

function assertAudienceGroup(value: AudienceGroup): void {
  if (!isAudienceGroup(value)) {
    throw new Error(`Invalid audience group: ${value}`);
  }
}

export const userRepository = {
  /** Find a user by their neutral domain user ID (Fable T24/A1). */
  async findById(userId: number): Promise<User | null> {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return rows[0] ?? null;
  },

  /** Create a new user. */
  async create(data: NewUser): Promise<User> {
    const db = getDb();
    // Idempotent get-or-create (E4/T18): Telegram fans out a new user's first
    // messages/callbacks concurrently, so two parallel creates must not 23505 on
    // the unique telegram_id. On conflict, re-select the row the winner inserted.
    const inserted = await db.insert(users).values(data).onConflictDoNothing({ target: users.telegramId }).returning();
    if (inserted[0]) {
      return inserted[0];
    }
    const existing = await db.select().from(users).where(eq(users.telegramId, data.telegramId)).limit(1);
    return existing[0]!;
  },

  /** Update user language settings (upsert). Throws if learningLangs exceeds MAX_LEARNING_LANGS.
   *  NOTE: Does NOT overwrite `lastSourceLang` unless explicitly provided — prevents accidental erasure. */
  async updateSettings(
    userId: number,
    settings: Omit<InsertUserLanguageSettings, "userId">,
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

  /** Update only the user's native language. */
  async updateNativeLang(userId: number, lang: string): Promise<UserLanguageSettings | null> {
    const db = getDb();
    const rows = await db
      .update(userLanguageSettings)
      .set({ nativeLang: lang, updatedAt: new Date() })
      .where(eq(userLanguageSettings.userId, userId))
      .returning();
    return rows[0] ?? null;
  },

  /** Update only the user's learning languages. Throws if exceeds MAX_LEARNING_LANGS. */
  async updateLearningLangs(userId: number, langs: string[]): Promise<UserLanguageSettings | null> {
    if (langs.length > MAX_LEARNING_LANGS) {
      throw new Error(`Maximum ${MAX_LEARNING_LANGS} learning languages allowed, got ${langs.length}`);
    }
    const db = getDb();
    const rows = await db
      .update(userLanguageSettings)
      .set({ learningLangs: langs, updatedAt: new Date() })
      .where(eq(userLanguageSettings.userId, userId))
      .returning();
    return rows[0] ?? null;
  },

  /** Update only the user's interface language. */
  async updateInterfaceLang(userId: number, lang: string): Promise<UserLanguageSettings | null> {
    const db = getDb();
    const rows = await db
      .update(userLanguageSettings)
      .set({ interfaceLang: lang, updatedAt: new Date() })
      .where(eq(userLanguageSettings.userId, userId))
      .returning();
    return rows[0] ?? null;
  },

  /** Update notification preferences (enable/disable, time slot, type). */
  async updateNotificationPrefs(
    userId: number,
    prefs: {
      notificationEnabled?: boolean;
      notificationTimes?: string[];
      notificationType?: string;
      notificationContext?: string | null;
    },
  ): Promise<UserLanguageSettings | null> {
    const db = getDb();
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (prefs.notificationEnabled !== undefined) set.notificationEnabled = prefs.notificationEnabled;
    if (prefs.notificationTimes !== undefined) set.notificationTimes = prefs.notificationTimes;
    if (prefs.notificationType !== undefined) set.notificationType = prefs.notificationType;
    if (prefs.notificationContext !== undefined) set.notificationContext = prefs.notificationContext;

    const rows = await db
      .update(userLanguageSettings)
      .set(set)
      .where(eq(userLanguageSettings.userId, userId))
      .returning();
    return rows[0] ?? null;
  },

  /** Update last interaction timestamp (fire-and-forget friendly). */
  async updateLastInteraction(userId: number): Promise<void> {
    const db = getDb();
    await db
      .update(userLanguageSettings)
      .set({ lastInteractionAt: new Date(), updatedAt: new Date() })
      .where(eq(userLanguageSettings.userId, userId));
  },

  /** List active bot users by audience group. */
  async listActiveByAudienceGroups(audienceGroups: AudienceGroup[]): Promise<User[]> {
    for (const audienceGroup of audienceGroups) {
      assertAudienceGroup(audienceGroup);
    }
    if (audienceGroups.length === 0) return [];

    const db = getDb();
    return db
      .select()
      .from(users)
      .where(and(eq(users.isActive, true), inArray(users.audienceGroup, audienceGroups)));
  },

  /** Update a bot user's release announcement audience group. */
  async updateAudienceGroup(userId: number, audienceGroup: AudienceGroup): Promise<User | null> {
    assertAudienceGroup(audienceGroup);
    const db = getDb();
    const rows = await db.update(users).set({ audienceGroup }).where(eq(users.id, userId)).returning();
    return rows[0] ?? null;
  },

  /**
   * Paginated user list for the admin panel with an optional username search.
   * The same filter drives both the page selection and the total count, so the
   * total stays consistent with the returned page when a search term is applied
   * (Fable T08/T27).
   */
  async listAdmin(params: { page: number; limit: number; search?: string }) {
    const db = getDb();
    const offset = (params.page - 1) * params.limit;
    const searchFilter = params.search ? ilike(users.username, `%${escapeLikePattern(params.search)}%`) : undefined;

    const usersList = await db
      .select({
        id: users.id,
        telegramId: users.telegramId,
        username: users.username,
        audienceGroup: users.audienceGroup,
        subscriptionPlan: users.subscriptionPlan,
        isActive: users.isActive,
        createdAt: users.createdAt,
        interfaceLang: userLanguageSettings.interfaceLang,
        nativeLang: userLanguageSettings.nativeLang,
        learningLangs: userLanguageSettings.learningLangs,
      })
      .from(users)
      .leftJoin(userLanguageSettings, eq(users.id, userLanguageSettings.userId))
      .where(searchFilter)
      .limit(params.limit)
      .offset(offset);

    const countResult = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(searchFilter);
    const total = countResult[0]?.count ?? 0;

    return { users: usersList, total };
  },

  /** Change a bot user's subscription plan. Returns false if no such user. */
  async updatePlan(userId: number, plan: string): Promise<boolean> {
    const db = getDb();
    const updated = await db
      .update(users)
      .set({ subscriptionPlan: plan })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    return updated.length > 0;
  },

  /** Check if a release announcement was already delivered to one user/group. */
  async hasReleaseAnnouncementDelivery(
    releaseId: string,
    audienceGroup: AudienceGroup,
    userId: number,
  ): Promise<boolean> {
    assertAudienceGroup(audienceGroup);
    const db = getDb();
    const rows = await db
      .select({ userId: releaseAnnouncementDeliveries.userId })
      .from(releaseAnnouncementDeliveries)
      .where(
        and(
          eq(releaseAnnouncementDeliveries.releaseId, releaseId),
          eq(releaseAnnouncementDeliveries.audienceGroup, audienceGroup),
          eq(releaseAnnouncementDeliveries.userId, userId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  /** Record a successful release announcement delivery. */
  async recordReleaseAnnouncementDelivery(
    releaseId: string,
    audienceGroup: AudienceGroup,
    userId: number,
  ): Promise<void> {
    assertAudienceGroup(audienceGroup);
    const db = getDb();
    await db.insert(releaseAnnouncementDeliveries).values({ releaseId, audienceGroup, userId }).onConflictDoNothing();
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

  /** Get CEFR proficiency levels for all learning languages. */
  async getLanguageLevels(userId: number): Promise<UserLearningLanguage[]> {
    const db = getDb();
    const rows = await db
      .select({
        languageCode: userLearningLanguages.languageCode,
        proficiencyLevel: userLearningLanguages.proficiencyLevel,
      })
      .from(userLearningLanguages)
      .where(eq(userLearningLanguages.userId, userId));
    return rows;
  },

  /** Set CEFR proficiency level for a specific learning language (upsert). */
  async setLanguageLevel(userId: number, languageCode: string, proficiencyLevel: string): Promise<void> {
    const db = getDb();
    await db
      .insert(userLearningLanguages)
      .values({ userId, languageCode, proficiencyLevel })
      .onConflictDoUpdate({
        target: [userLearningLanguages.userId, userLearningLanguages.languageCode],
        set: { proficiencyLevel, updatedAt: new Date() },
      });
  },
};

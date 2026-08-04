import type {
  ActivationNudgeCandidate,
  AudienceGroup,
  NewUser,
  SubscriptionPlan,
  User,
  UserLanguageSettings,
  UserLearningLanguage,
} from "@polyglot/core";
import { ACTIVATION_NUDGE_SOURCE, logger } from "@polyglot/core";
import { and, count, eq, gte, ilike, inArray, isNotNull, lte, notExists, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { escapeLikePattern } from "../like-escape.js";
import {
  notificationHistory,
  releaseAnnouncementDeliveries,
  translationRequests,
  userLanguageSettings,
  userLearningLanguages,
  users,
} from "../schema.js";

export type { ActivationNudgeCandidate, AudienceGroup, NewUser, SubscriptionPlan, User, UserLanguageSettings };

/** How long after finishing onboarding the activation nudge becomes due. */
export const ACTIVATION_NUDGE_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back the nudge window reaches. Without an upper bound this is not a
 * D+1 nudge at all: a user who onboarded three months ago, never translated, and
 * has long since forgotten the bot would be sent "Still curious?" as though they
 * had signed up yesterday. Today that is masked only by `onboarded_at` being a
 * new column with no old rows in it — the accident expires on its own.
 *
 * The window is deliberately wider than the daily cron interval (72h against a
 * 24h cadence) so a missed sweep — a deploy, an outage, a paused cron — does not
 * silently skip a whole day's cohort. Overlapping sweeps cannot double-send: the
 * `notification_history` row written on delivery is what makes the nudge
 * one-shot, not the width of this window.
 */
export const ACTIVATION_NUDGE_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/**
 * Fan-out cap for a single nudge sweep. The cron runs daily and the eligible
 * cohort is "users who onboarded yesterday and never translated", so a healthy
 * day is far below this; hitting the cap means either a backlog after downtime
 * or a bug, and either way we would rather send 500 messages and log it than
 * hand Telegram an unbounded burst. The remainder is picked up tomorrow.
 */
export const ACTIVATION_NUDGE_BATCH_LIMIT = 500;

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

  /** Read the retained legacy `users.telegram_id` chat id for a user (Fable T24 outbound fallback). */
  async getTelegramIdById(userId: number): Promise<number | null> {
    const db = getDb();
    const rows = await db.select({ telegramId: users.telegramId }).from(users).where(eq(users.id, userId)).limit(1);
    return rows[0]?.telegramId ?? null;
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

  /** Update a user's subscription plan pointer (manual grant, mock upgrade, cron downgrade). */
  async updateSubscriptionPlan(userId: number, plan: string): Promise<User | null> {
    const db = getDb();
    const rows = await db.update(users).set({ subscriptionPlan: plan }).where(eq(users.id, userId)).returning();
    return rows[0] ?? null;
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

  /**
   * Mark user as onboarded. Step 4 is the "complete" screen of the Task 72
   * 4-screen flow (native → languages → demo → complete).
   *
   * Rows completed under the previous 3-screen flow carry `onboarding_step = 3`
   * and are not backfilled, so read `onboarded` — never the step alone — to tell
   * a finished user from one who abandoned on the demo screen.
   */
  async markOnboarded(userId: number): Promise<User> {
    const db = getDb();
    const rows = await db
      .update(users)
      .set({ onboarded: true, onboardingStep: 4, onboardedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return rows[0]!;
  },

  /**
   * Users due the one-off D+1 activation nudge (Task 72, slice 8).
   *
   * Both "has not translated since finishing" and "has not been nudged" are
   * correlated `NOT EXISTS` subqueries rather than a client-side filter: the
   * alternative is pulling every onboarded user into the process and then
   * issuing a query per user, which is unbounded work for a set that is almost
   * always empty.
   *
   * `onboarded_at IS NULL` is excluded deliberately — see the column comment in
   * `schema.ts`. Those are pre-slice-8 rows whose completion instant is
   * unknowable; treating them as eligible would nudge months-old accounts.
   */
  async findActivationNudgeCandidates(
    now: Date,
    limit: number = ACTIVATION_NUDGE_BATCH_LIMIT,
  ): Promise<ActivationNudgeCandidate[]> {
    const db = getDb();
    const cutoff = new Date(now.getTime() - ACTIVATION_NUDGE_DELAY_MS);
    const oldest = new Date(now.getTime() - ACTIVATION_NUDGE_MAX_AGE_MS);

    const rows = await db
      .select({
        userId: users.id,
        telegramId: users.telegramId,
        interfaceLang: userLanguageSettings.interfaceLang,
        nativeLang: userLanguageSettings.nativeLang,
        learningLangs: userLanguageSettings.learningLangs,
      })
      .from(users)
      .innerJoin(userLanguageSettings, eq(userLanguageSettings.userId, users.id))
      .where(
        and(
          eq(users.onboarded, true),
          eq(users.isActive, true),
          isNotNull(users.onboardedAt),
          lte(users.onboardedAt, cutoff),
          gte(users.onboardedAt, oldest),
          // `notification_enabled` is deliberately NOT consulted here, and the
          // omission is load-bearing rather than an oversight. The column
          // defaults to **false** and governs the recurring vocabulary-reminder
          // scheduler, which users opt *into*; filtering on it would exclude
          // every user who simply never visited that setting — i.e. almost all
          // of them — and quietly reduce this sweep to a no-op.
          //
          // The harm it looks like it would prevent is already prevented: a user
          // who blocked the bot is retired on the first failed send (the
          // `notification_history` row below), so they are never re-selected, and
          // this is a single lifecycle message rather than a subscription.
          notExists(
            db
              .select({ one: sql`1` })
              .from(translationRequests)
              .where(
                and(eq(translationRequests.userId, users.id), gte(translationRequests.createdAt, users.onboardedAt)),
              ),
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(notificationHistory)
              .where(
                and(eq(notificationHistory.userId, users.id), eq(notificationHistory.source, ACTIVATION_NUDGE_SOURCE)),
              ),
          ),
        ),
      )
      .limit(limit);

    if (rows.length >= limit) {
      logger.warn({ limit }, "Activation-nudge batch hit the fan-out cap — remainder deferred to the next sweep");
    }
    return rows;
  },

  /** Onboarding funnel: users grouped by the furthest step reached, split by completion. */
  async getOnboardingFunnel(): Promise<Array<{ step: number; onboarded: boolean; count: number }>> {
    const db = getDb();
    const rows = await db
      .select({ step: users.onboardingStep, onboarded: users.onboarded, count: count() })
      .from(users)
      .groupBy(users.onboardingStep, users.onboarded)
      .orderBy(users.onboardingStep, users.onboarded);
    return rows.map((row) => ({ step: row.step, onboarded: row.onboarded, count: Number(row.count) }));
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

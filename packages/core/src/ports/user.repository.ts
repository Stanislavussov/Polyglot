export type SubscriptionPlan = string;
export type AudienceGroup = "admin" | "tester" | "product";

/**
 * Port interface for UserRepository.
 */
export interface User {
  id: number;
  username: string | null;
  audienceGroup: AudienceGroup;
  subscriptionPlan: SubscriptionPlan;
  onboardingStep: number;
  onboarded: boolean;
  isActive: boolean;
  createdAt: Date;
}

/**
 * Channel-adapter creation DTO. `telegramId` remains here (unlike the domain
 * `User` read model, which no longer carries it) because provisioning a user row
 * is a channel concern and the retained `users.telegram_id` column is NOT NULL —
 * the Telegram channel adapter supplies it at creation, then links an identity.
 */
export interface NewUser {
  telegramId: number;
  username?: string | null;
  audienceGroup?: AudienceGroup;
}

export interface UserLanguageSettings {
  id: number;
  userId: number;
  interfaceLang: string;
  nativeLang: string;
  learningLangs: string[];
  timezone: string;
  activeMode: string;
  lastSourceLang: string | null;
  notificationEnabled: boolean;
  notificationTimes: string[];
  notificationType: string;
  notificationContext: string | null;
  lastInteractionAt: Date | null;
  isActive: boolean;
  updatedAt: Date;
}

export interface UserLearningLanguage {
  languageCode: string;
  proficiencyLevel: string;
}

export interface UserRepository {
  findById(userId: number): Promise<User | null>;
  create(data: NewUser): Promise<User>;
  getSettings(userId: number): Promise<UserLanguageSettings | null>;
  updateSettings(userId: number, settings: Partial<UserLanguageSettings>): Promise<UserLanguageSettings>;
  updateNativeLang(userId: number, lang: string): Promise<UserLanguageSettings | null>;
  updateLearningLangs(userId: number, langs: string[]): Promise<UserLanguageSettings | null>;
  updateInterfaceLang(userId: number, lang: string): Promise<UserLanguageSettings | null>;
  updateActiveMode(userId: number, mode: string): Promise<UserLanguageSettings | null>;
  updateLastSourceLang(userId: number, lang: string | null): Promise<void>;
  updateNotificationPrefs(
    userId: number,
    prefs: { notificationEnabled?: boolean; notificationTimes?: string[]; notificationType?: string },
  ): Promise<UserLanguageSettings | null>;
  updateLastInteraction(userId: number): Promise<void>;
  listActiveByAudienceGroups(audienceGroups: AudienceGroup[]): Promise<User[]>;
  updateAudienceGroup(userId: number, audienceGroup: AudienceGroup): Promise<User | null>;
  hasReleaseAnnouncementDelivery(releaseId: string, audienceGroup: AudienceGroup, userId: number): Promise<boolean>;
  recordReleaseAnnouncementDelivery(releaseId: string, audienceGroup: AudienceGroup, userId: number): Promise<void>;
  markOnboarded(userId: number): Promise<User>;
  updateOnboardingStep(userId: number, step: number): Promise<User>;
  getLanguageLevels(userId: number): Promise<UserLearningLanguage[]>;
  setLanguageLevel(userId: number, languageCode: string, proficiencyLevel: string): Promise<void>;
}

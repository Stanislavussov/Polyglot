/**
 * Port interface for UserRepository.
 */
export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  onboardingStep: number;
  onboarded: boolean;
  isActive: boolean;
  createdAt: Date;
}

export interface NewUser {
  telegramId: number;
  username?: string | null;
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
  notificationTime: string;
  notificationType: string;
  notificationContext: string | null;
  lastInteractionAt: Date | null;
  isActive: boolean;
  updatedAt: Date;
}

export interface UserRepository {
  findByTelegramId(telegramId: number): Promise<User | null>;
  create(data: NewUser): Promise<User>;
  getSettings(userId: number): Promise<UserLanguageSettings | null>;
  updateSettings(userId: number, settings: Partial<UserLanguageSettings>): Promise<UserLanguageSettings>;
  updateNativeLang(userId: number, lang: string): Promise<void>;
  updateLearningLangs(userId: number, langs: string[]): Promise<void>;
  updateInterfaceLang(userId: number, lang: string): Promise<void>;
  updateActiveMode(userId: number, mode: string): Promise<void>;
  updateLastSourceLang(userId: number, lang: string | null): Promise<void>;
  updateNotificationPrefs(
    userId: number,
    prefs: { notificationEnabled?: boolean; notificationTime?: string; notificationType?: string },
  ): Promise<void>;
  updateLastInteraction(userId: number): Promise<void>;
  markOnboarded(userId: number): Promise<void>;
}

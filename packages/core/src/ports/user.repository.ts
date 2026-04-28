/**
 * Port interface for UserRepository.
 */
export interface User {
  id: number;
  telegramId: number;
  interfaceLang: string;
  nativeLang: string;
  learningLangs: string[];
  activeMode: string;
  timezone: string;
  lastSourceLang: string | null;
}
export interface NewUser {
  telegramId: number;
}
export interface UserLanguageSettings {
  interfaceLang: string;
  nativeLang: string;
  learningLangs: string[];
  activeMode: string;
  timezone: string;
  lastSourceLang: string | null;
}
export interface UserRepository {
  findByTelegramId(telegramId: number): Promise<User | null>;
  create(data: NewUser): Promise<User>;
  getSettings(userId: number): Promise<UserLanguageSettings | null>;
  updateSettings(userId: number, settings: Partial<UserLanguageSettings>): Promise<void>;
  updateNativeLang(userId: number, lang: string): Promise<void>;
  updateLearningLangs(userId: number, langs: string[]): Promise<void>;
  updateInterfaceLang(userId: number, lang: string): Promise<void>;
  updateActiveMode(userId: number, mode: string): Promise<void>;
  updateLastSourceLang(userId: number, lang: string | null): Promise<void>;
  markOnboarded(userId: number): Promise<void>;
}

/**
 * Language Cache Port.
 */
export interface CachedLanguage {
  id: number;
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  isSupported: boolean;
}

export interface LanguageCachePort {
  loadLanguageCache(): Promise<void>;
  isLanguageCacheLoaded(): boolean;
  getLang(code: string): CachedLanguage | undefined;
  getAllLangs(): CachedLanguage[];
  getSupportedLangs(): CachedLanguage[];
  getLangName(code: string, displayLang?: string): string;
  getLangNativeName(code: string): string;
  getLangFlag(code: string): string | undefined;
  getLangDisplay(code: string): string;
  isKnownLang(code: string): boolean;
  normalizeToIso1(lang: string): string | undefined;
}

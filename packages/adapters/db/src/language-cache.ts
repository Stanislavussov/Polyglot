/**
 * Language Cache — loads all languages from DB at startup, serves from memory.
 *
 * The `languages` table is the single source of truth for all language metadata.
 * This cache loads the table once and provides typed getters.
 *
 * Must call `loadLanguageCache()` at app startup (after DB is connected).
 */
import { getDb } from "./index.js";
import { languages } from "./schema.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CachedLanguage {
  id: number;
  /** ISO 639-1 code: "en", "ru", "cs" */
  code: string;
  /** English name: "English", "Russian" */
  name: string;
  /** Native/autonym name: "Русский", "Deutsch" */
  nativeName: string | null;
  /** Emoji flag: "🇬🇧", "🇷🇺" */
  flag: string | null;
  /** ISO 639-3 code: "eng", "rus" */
  iso3Code: string | null;
  /** Available as interface/learning language in bot UI */
  isSupported: boolean;
  /** Localized display names: {"ru": "Английский", "cs": "Angličtina"} */
  localizedNames: Record<string, string> | null;
}

/* ------------------------------------------------------------------ */
/*  Cache state                                                        */
/* ------------------------------------------------------------------ */

const byCode = new Map<string, CachedLanguage>();
const byIso3 = new Map<string, CachedLanguage>();
let loaded = false;

/* ------------------------------------------------------------------ */
/*  Initialization                                                     */
/* ------------------------------------------------------------------ */

/**
 * Load all languages from the DB into memory.
 * Call once at app startup after DB connection is established.
 * Safe to call multiple times (reloads).
 */
export async function loadLanguageCache(): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(languages);

  byCode.clear();
  byIso3.clear();

  for (const row of rows) {
    const entry: CachedLanguage = {
      id: row.id,
      code: row.code,
      name: row.name,
      nativeName: row.nativeName,
      flag: row.flag,
      iso3Code: row.iso3Code,
      isSupported: row.isSupported,
      localizedNames: row.localizedNames as Record<string, string> | null,
    };
    byCode.set(entry.code, entry);
    if (entry.iso3Code) {
      byIso3.set(entry.iso3Code, entry);
    }
  }

  loaded = true;
}

/**
 * Check if the cache has been loaded.
 */
export function isLanguageCacheLoaded(): boolean {
  return loaded;
}

/* ------------------------------------------------------------------ */
/*  Getters                                                            */
/* ------------------------------------------------------------------ */

/** Get a language by ISO 639-1 code. */
export function getLang(code: string): CachedLanguage | undefined {
  return byCode.get(code);
}

/** Get all loaded languages. */
export function getAllLangs(): CachedLanguage[] {
  return [...byCode.values()];
}

/** Get languages marked as supported (available in bot UI). */
export function getSupportedLangs(): CachedLanguage[] {
  return [...byCode.values()].filter((l) => l.isSupported);
}

/**
 * Get English name for a language code.
 * Falls back to code if not found.
 */
export function getLangName(code: string, displayLang?: string): string {
  const entry = byCode.get(code);
  if (!entry) return code;

  // Localized name in requested display language
  if (displayLang && displayLang !== "en" && entry.localizedNames?.[displayLang]) {
    return entry.localizedNames[displayLang];
  }

  return entry.name;
}

/**
 * Get native/autonym name for a language code.
 * Falls back to English name, then code.
 */
export function getLangNativeName(code: string): string {
  const entry = byCode.get(code);
  if (!entry) return code;
  return entry.nativeName ?? entry.name;
}

/** Get emoji flag for a language code. */
export function getLangFlag(code: string): string | undefined {
  return byCode.get(code)?.flag ?? undefined;
}

/**
 * Get display string for a language: "🇷🇺 Русский".
 * Falls back to code if not found.
 */
export function getLangDisplay(code: string): string {
  const entry = byCode.get(code);
  if (!entry) return code;
  const label = entry.nativeName ?? entry.name;
  return entry.flag ? `${entry.flag} ${label}` : label;
}

/** Get ISO 639-3 code from ISO 639-1 code. */
export function getIso3(code: string): string | undefined {
  return byCode.get(code)?.iso3Code ?? undefined;
}

/** Get ISO 639-1 code from ISO 639-3 code. */
export function getIso1FromIso3(iso3: string): string | undefined {
  return byIso3.get(iso3)?.code;
}

/** Check if a language code is known. */
export function isKnownLang(code: string): boolean {
  return byCode.has(code);
}

/**
 * Build ISO 639-1 → ISO 639-3 mapping from cached data.
 * Used by franc-based language detection.
 */
export function getIso1ToIso3Map(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of byCode.values()) {
    if (entry.iso3Code) {
      map[entry.code] = entry.iso3Code;
    }
  }
  return map;
}

/**
 * Build ISO 639-3 → ISO 639-1 mapping from cached data.
 */
export function getIso3ToIso1Map(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of byCode.values()) {
    if (entry.iso3Code) {
      map[entry.iso3Code] = entry.code;
    }
  }
  return map;
}

/**
 * Normalize any recognized language identifier to ISO 639-1.
 * Accepts ISO 639-1 (passthrough), ISO 639-3, or English names.
 */
export function normalizeToIso1(lang: string): string | undefined {
  const lower = lang.toLowerCase();

  // Already ISO 639-1
  if (byCode.has(lower)) return lower;

  // ISO 639-3 → ISO 639-1
  const fromIso3 = byIso3.get(lower);
  if (fromIso3) return fromIso3.code;

  // English name (case-insensitive search)
  for (const entry of byCode.values()) {
    if (entry.name.toLowerCase() === lower) return entry.code;
  }

  return undefined;
}

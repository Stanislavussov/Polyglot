/**
 * Language Cache — loads all languages from DB at startup, serves from memory.
 *
 * The `languages` table is the single source of truth for all language metadata.
 * This cache loads the table once and provides typed getters.
 *
 * Works exclusively with ISO 639-1 codes.
 * ISO 639-3 codes are a private implementation detail of detect-language.ts in core.
 *
 * Must call `loadLanguageCache()` at app startup (after DB is connected).
 */
import type { CachedLanguage } from "@polyglot/core";
import { getDb } from "./connection.js";
import { languages } from "./schema.js";

export type { CachedLanguage };

/* ------------------------------------------------------------------ */
/*  Cache state                                                        */
/* ------------------------------------------------------------------ */

const byCode = new Map<string, CachedLanguage>();
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

  for (const row of rows) {
    const entry: CachedLanguage = {
      id: row.id,
      code: row.code,
      name: row.name,
      nativeName: row.nativeName,
      flag: row.flag,
      isSupported: row.isSupported,
      localizedNames: row.localizedNames as Record<string, string> | null,
    };
    byCode.set(entry.code, entry);
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

/** Check if a language code is known. */
export function isKnownLang(code: string): boolean {
  return byCode.has(code);
}

/**
 * Normalize any recognized language identifier to ISO 639-1.
 * Accepts ISO 639-1 (passthrough) or English names (case-insensitive).
 */
export function normalizeToIso1(lang: string): string | undefined {
  const lower = lang.toLowerCase();

  // Already ISO 639-1
  if (byCode.has(lower)) return lower;

  // English name (case-insensitive search)
  for (const entry of byCode.values()) {
    if (entry.name.toLowerCase() === lower) return entry.code;
  }

  return undefined;
}

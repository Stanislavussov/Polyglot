/**
 * Language Cache — the DB loader for the core language registry.
 *
 * The `languages` table is the single source of truth. This module reads it once
 * at startup and hands the rows to core's `initLanguageRegistry`, which is the
 * single in-memory store (Fable T21/A3). Every getter below delegates to that
 * registry — there is no second cache Map or duplicated normalization logic here.
 *
 * Works exclusively with ISO 639-1 codes. ISO 639-3 codes are a private
 * implementation detail of detect-language.ts in core.
 *
 * Must call `loadLanguageCache()` at app startup (after DB is connected).
 */
import type { CachedLanguage } from "@polyglot/core";
import {
  getAllLanguageEntries,
  getLanguageEntry,
  getLanguageName,
  getLanguageNativeName,
  getSupportedLanguages,
  initLanguageRegistry,
  isKnownLanguage,
  isRegistryInitialized,
  getLangDisplay as registryGetLangDisplay,
  getLangFlag as registryGetLangFlag,
  normalizeToIso1 as registryNormalizeToIso1,
} from "@polyglot/core";
import { getDb } from "./connection.js";
import { languages } from "./schema.js";

export type { CachedLanguage };

/* ------------------------------------------------------------------ */
/*  Initialization                                                     */
/* ------------------------------------------------------------------ */

/**
 * Load all languages from the DB into the core registry.
 * Call once at app startup after DB connection is established.
 * Safe to call multiple times (reloads).
 */
export async function loadLanguageCache(): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(languages);

  initLanguageRegistry(
    rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      nativeName: row.nativeName,
      flag: row.flag,
      isSupported: row.isSupported,
      localizedNames: row.localizedNames as Record<string, string> | null,
    })),
  );
}

/** Check if the registry has been loaded. */
export function isLanguageCacheLoaded(): boolean {
  return isRegistryInitialized();
}

/* ------------------------------------------------------------------ */
/*  Getters — thin delegates to the core registry                      */
/* ------------------------------------------------------------------ */

/** Get a language by ISO 639-1 code. */
export function getLang(code: string): CachedLanguage | undefined {
  return getLanguageEntry(code);
}

/** Get all loaded languages. */
export function getAllLangs(): CachedLanguage[] {
  return getAllLanguageEntries();
}

/** Get languages marked as supported (available in bot UI). */
export function getSupportedLangs(): CachedLanguage[] {
  return getSupportedLanguages();
}

/** Get the name for a language code, optionally localized into `displayLang`. */
export function getLangName(code: string, displayLang?: string): string {
  return getLanguageName(code, displayLang);
}

/** Get native/autonym name for a language code. */
export function getLangNativeName(code: string): string {
  return getLanguageNativeName(code);
}

/** Get emoji flag for a language code. */
export function getLangFlag(code: string): string | undefined {
  return registryGetLangFlag(code);
}

/** Get display string for a language: "🇷🇺 Русский". */
export function getLangDisplay(code: string): string {
  return registryGetLangDisplay(code);
}

/** Check if a language code is known. */
export function isKnownLang(code: string): boolean {
  return isKnownLanguage(code);
}

/** Normalize any recognized language identifier to ISO 639-1. */
export function normalizeToIso1(lang: string): string | undefined {
  return registryNormalizeToIso1(lang);
}

/**
 * Language Registry — runtime store for language metadata.
 *
 * The DB `languages` table is the single source of truth.
 * At app startup, the caller loads languages from DB and calls
 * `initLanguageRegistry()` to populate this registry.
 *
 * All language lookups (getLanguageName, etc.) read from here.
 * Core never touches the DB directly — data is injected.
 *
 * The registry works exclusively with ISO 639-1 codes.
 * ISO 639-3 codes are a private implementation detail of detect-language.ts.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

import type { CachedLanguage } from "../../ports/language-cache.port.js";

/**
 * Loose input shape for {@link initLanguageRegistry}. Every field except
 * `code`/`name`/`isSupported` is optional so callers (and tests) can supply a
 * partial row; {@link initLanguageRegistry} normalizes each entry to the
 * canonical {@link CachedLanguage} the registry stores.
 */
export interface LanguageEntry {
  id?: number;
  code: string;
  name: string;
  nativeName?: string | null;
  flag?: string | null;
  isSupported: boolean;
  localizedNames?: Record<string, string> | null;
}

/* ------------------------------------------------------------------ */
/*  Registry state                                                     */
/* ------------------------------------------------------------------ */

// The registry is the single in-memory source of truth for language metadata
// (Fable T21/A3). The adapter-db `language-cache` is a thin loader/delegator on
// top of this — there is no second store or duplicated normalization logic.
const byCode = new Map<string, CachedLanguage>();

/* ------------------------------------------------------------------ */
/*  Initialization                                                     */
/* ------------------------------------------------------------------ */

/**
 * Populate the registry with language data (typically from DB).
 * Call once at app startup. Safe to call multiple times (replaces).
 *
 * @example
 * const rows = await languageRepository.findAll();
 * initLanguageRegistry(rows);
 */
export function initLanguageRegistry(entries: LanguageEntry[]): void {
  byCode.clear();
  for (const entry of entries) {
    byCode.set(entry.code, {
      id: entry.id ?? 0,
      code: entry.code,
      name: entry.name,
      nativeName: entry.nativeName ?? null,
      flag: entry.flag ?? null,
      isSupported: entry.isSupported,
      localizedNames: entry.localizedNames ?? null,
    });
  }
}

/**
 * Check if the registry has been initialized.
 */
export function isRegistryInitialized(): boolean {
  return byCode.size > 0;
}

/* ------------------------------------------------------------------ */
/*  Name lookups                                                       */
/* ------------------------------------------------------------------ */

/**
 * Get the human-readable name of a language by its ISO 639-1 code.
 *
 * @param code      ISO 639-1 code (e.g. "ru", "en")
 * @param displayLang  Show the name in this language (e.g. "ru" → "Английский")
 * @returns Localized name, English name, or code as fallback
 */
export function getLanguageName(code: string, displayLang?: string): string {
  const entry = byCode.get(code);
  if (!entry) return code;

  if (displayLang && displayLang !== "en" && entry.localizedNames?.[displayLang]) {
    return entry.localizedNames[displayLang];
  }

  return entry.name;
}

/**
 * Get the native (autonym) name: "Русский", "Deutsch".
 */
export function getLanguageNativeName(code: string): string {
  const entry = byCode.get(code);
  if (!entry) return code;
  return entry.nativeName ?? entry.name;
}

/**
 * Get all known language entries as { code, name } pairs.
 */
export function getAllLanguageNames(): Array<{ code: string; name: string }> {
  return [...byCode.values()].map(({ code, name }) => ({ code, name }));
}

/**
 * Check if a language code is known in the registry.
 */
export function isKnownLanguage(code: string): boolean {
  return byCode.has(code);
}

/**
 * Whether a language is offered for study (its `isSupported` DB flag is set).
 *
 * This is the correct gate for "can the user add this as a learning language",
 * distinct from the i18n `isSupported` which only covers UI locales. An unknown
 * or study-disabled code returns false.
 */
export function isSupportedLanguage(code: string): boolean {
  return byCode.get(code)?.isSupported === true;
}

/* ------------------------------------------------------------------ */
/*  Normalization                                                      */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Display helpers                                                    */
/* ------------------------------------------------------------------ */

/** Get emoji flag for a language code. */
export function getLangFlag(code: string): string | undefined {
  return byCode.get(code)?.flag ?? undefined;
}

/** Get display string: "🇷🇺 Русский". */
export function getLangDisplay(code: string): string {
  const entry = byCode.get(code);
  if (!entry) return code;
  const label = entry.nativeName ?? entry.name;
  return entry.flag ? `${entry.flag} ${label}` : label;
}

/** Get a single language entry by ISO 639-1 code (undefined if unknown). */
export function getLanguageEntry(code: string): CachedLanguage | undefined {
  return byCode.get(code);
}

/** Get every known language entry. */
export function getAllLanguageEntries(): CachedLanguage[] {
  return [...byCode.values()];
}

/** Get all supported languages (for bot UI). */
export function getSupportedLanguages(): CachedLanguage[] {
  return [...byCode.values()].filter((l) => l.isSupported);
}

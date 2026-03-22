/**
 * Language Registry — runtime store for language metadata.
 *
 * The DB `languages` table is the single source of truth.
 * At app startup, the caller loads languages from DB and calls
 * `initLanguageRegistry()` to populate this registry.
 *
 * All language lookups (getLanguageName, getIso3, etc.) read from here.
 * Core never touches the DB directly — data is injected.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LanguageEntry {
  code: string;
  name: string;
  nativeName?: string | null;
  flag?: string | null;
  iso3Code?: string | null;
  isSupported: boolean;
  localizedNames?: Record<string, string> | null;
}

/* ------------------------------------------------------------------ */
/*  Registry state                                                     */
/* ------------------------------------------------------------------ */

const byCode = new Map<string, LanguageEntry>();
const byIso3 = new Map<string, string>(); // iso3 → iso1

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
  byIso3.clear();
  for (const entry of entries) {
    byCode.set(entry.code, entry);
    if (entry.iso3Code) {
      byIso3.set(entry.iso3Code, entry.code);
    }
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

/* ------------------------------------------------------------------ */
/*  ISO code lookups                                                   */
/* ------------------------------------------------------------------ */

/** ISO 639-1 → ISO 639-3 mapping from registry. */
export function getIso1ToIso3Map(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of byCode.values()) {
    if (entry.iso3Code) {
      map[entry.code] = entry.iso3Code;
    }
  }
  return map;
}

/** ISO 639-3 → ISO 639-1 mapping from registry. */
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
 * Resolve any language identifier to ISO 639-3 code.
 */
export function resolveToIso3(lang: string): string | undefined {
  const lower = lang.toLowerCase();

  // ISO 639-1 → ISO 639-3
  const entry = byCode.get(lower);
  if (entry?.iso3Code) return entry.iso3Code;

  // ISO 639-3 passthrough
  if (byIso3.has(lower)) return lower;

  // English name
  for (const e of byCode.values()) {
    if (e.name.toLowerCase() === lower) return e.iso3Code ?? undefined;
  }

  return undefined;
}

/**
 * Normalize any recognized language identifier to ISO 639-1.
 */
export function normalizeToIso1(lang: string): string | undefined {
  const lower = lang.toLowerCase();

  // Already ISO 639-1
  if (byCode.has(lower)) return lower;

  // ISO 639-3 → ISO 639-1
  const fromIso3 = byIso3.get(lower);
  if (fromIso3) return fromIso3;

  // English name
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

/** Get all supported languages (for bot UI). */
export function getSupportedLanguages(): LanguageEntry[] {
  return [...byCode.values()].filter((l) => l.isSupported);
}

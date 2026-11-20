// The server can name a language outside the learner's language list (an unsupported
// one it detected), and the list is the only place names and flags come from; the
// browser's locale data fills the gap so the learner never reads a bare ISO code.

export function unlistedLanguageName(code: string, displayLang: string): string {
  try {
    const name = new Intl.DisplayNames([displayLang, "en"], { type: "language", fallback: "none" }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(displayLang) + name.slice(1) : code;
  } catch {
    return code;
  }
}

/** The lowercase country most associated with a language ("hr" → "hr", "cs" → "cz"), for its flag. */
export function languageCountry(code: string): string | null {
  try {
    return new Intl.Locale(code).maximize().region?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

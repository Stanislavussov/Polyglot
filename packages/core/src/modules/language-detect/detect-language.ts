import { franc } from "franc";
import type { DictionaryContext } from "../translation/types.js";

/**
 * Language Detection Strategy Interface
 *
 * Pluggable detection methods that can be chained.
 * Each strategy attempts detection, returning undefined if inconclusive.
 * Both sync and async strategies are supported.
 */
export interface LanguageDetectionStrategy {
  /** Human-readable name for debugging/logging */
  readonly name: string;

  /**
   * Attempt to detect language from text.
   * @param text - Input text to analyze
   * @param candidates - ISO 639-1 language codes to consider
   * @returns Detected ISO 639-1 code, or undefined if inconclusive.
   *          Async strategies return a Promise.
   */
  detect(text: string, candidates: string[]): string | undefined | Promise<string | undefined>;
}

// ============================================================================
// Strategy 1: Script-based detection (fast, works for any text length)
// ============================================================================

/** Unicode script ranges for heuristic detection */
type ScriptId = "cyrillic" | "latin" | "cjk" | "arabic" | "devanagari" | "greek" | "hangul" | "kana";

function classifyCodePoint(cp: number): ScriptId | undefined {
  if ((cp >= 0x0400 && cp <= 0x04ff) || (cp >= 0x0500 && cp <= 0x052f)) return "cyrillic";
  if (
    (cp >= 0x0041 && cp <= 0x024f) ||
    (cp >= 0x1e00 && cp <= 0x1eff) ||
    (cp >= 0x0100 && cp <= 0x017f) ||
    (cp >= 0x0180 && cp <= 0x024f)
  )
    return "latin";
  if (cp >= 0x4e00 && cp <= 0x9fff) return "cjk";
  if (cp >= 0x0600 && cp <= 0x06ff) return "arabic";
  if (cp >= 0x0900 && cp <= 0x097f) return "devanagari";
  if (cp >= 0x0370 && cp <= 0x03ff) return "greek";
  if (cp >= 0xac00 && cp <= 0xd7af) return "hangul";
  if ((cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff)) return "kana";
  return undefined;
}

const SCRIPT_TO_LANGS: Record<ScriptId, string[]> = {
  cyrillic: ["ru", "uk", "bg", "sr"],
  latin: [
    "en",
    "cs",
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "pl",
    "nl",
    "sv",
    "da",
    "no",
    "fi",
    "tr",
    "hu",
    "ro",
    "hr",
    "sk",
    "sl",
    "lt",
    "lv",
    "et",
  ],
  cjk: ["zh", "ja"],
  arabic: ["ar"],
  devanagari: ["hi"],
  greek: ["el"],
  hangul: ["ko"],
  kana: ["ja"],
};

function detectScript(text: string): ScriptId | undefined {
  const counts: Partial<Record<ScriptId, number>> = {};
  let total = 0;

  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    const script = classifyCodePoint(cp);
    if (script) {
      counts[script] = (counts[script] ?? 0) + 1;
      total++;
    }
  }

  if (total === 0) return undefined;

  let best: ScriptId | undefined;
  let bestCount = 0;
  for (const [script, count] of Object.entries(counts) as [ScriptId, number][]) {
    if (count > bestCount) {
      best = script;
      bestCount = count;
    }
  }

  return best;
}

/**
 * Script-based strategy: detects language from Unicode script.
 * Works for any text length, but can only distinguish scripts.
 * Returns undefined if multiple candidates share the same script.
 */
export class ScriptStrategy implements LanguageDetectionStrategy {
  readonly name = "script";

  detect(text: string, candidates: string[]): string | undefined {
    const script = detectScript(text);
    if (!script) return undefined;

    const scriptLangs = SCRIPT_TO_LANGS[script] ?? [];
    const matches = candidates.filter((c) => scriptLangs.includes(c));

    // Exactly one candidate matches → confident
    if (matches.length === 1) return matches[0];

    // Multiple or zero matches → inconclusive
    return undefined;
  }
}

// ============================================================================
// Strategy 2: Franc-based detection (statistical, good for 3+ words)
// ============================================================================

export const ISO1_TO_ISO3: Readonly<Record<string, string>> = Object.freeze({
  en: "eng",
  ru: "rus",
  cs: "ces",
  de: "deu",
  fr: "fra",
  es: "spa",
  it: "ita",
  pt: "por",
  uk: "ukr",
  pl: "pol",
  ja: "jpn",
  zh: "cmn",
  ko: "kor",
  ar: "arb",
  hi: "hin",
  tr: "tur",
  nl: "nld",
  sv: "swe",
  da: "dan",
  no: "nob",
  fi: "fin",
  el: "ell",
  hu: "hun",
  ro: "ron",
  bg: "bul",
  hr: "hrv",
  sk: "slk",
  sl: "slv",
  sr: "srp",
  lt: "lit",
  lv: "lav",
  et: "est",
  he: "heb",
  th: "tha",
  vi: "vie",
  ka: "kat",
  id: "ind",
  af: "afr",
  ca: "cat",
  sq: "sqi",
  mk: "mkd",
  be: "bel",
  fa: "fas",
  sw: "swa",
});

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Franc-based strategy: statistical trigram detection.
 * Best for texts with 3+ words. Returns undefined for short inputs.
 */
export class FrancStrategy implements LanguageDetectionStrategy {
  readonly name = "franc";

  detect(text: string, candidates: string[]): string | undefined {
    // Franc is unreliable for short texts
    if (wordCount(text) < 3) return undefined;

    const iso3Candidates: string[] = [];
    const iso3ToCandidate: Record<string, string> = {};

    for (const c of candidates) {
      const iso3 = ISO1_TO_ISO3[c];
      if (iso3) {
        iso3Candidates.push(iso3);
        iso3ToCandidate[iso3] = c;
      }
    }

    if (iso3Candidates.length === 0) return undefined;

    const detected = franc(text, { only: iso3Candidates });
    if (detected === "und") return undefined;

    return iso3ToCandidate[detected];
  }
}

// ============================================================================
// Strategy 3: Diacritics-based detection (language-specific character patterns)
// ============================================================================

/** Diacritics patterns that are unique to specific languages */
const DIACRITIC_PATTERNS: Readonly<Record<string, RegExp>> = Object.freeze({
  // Czech: ř, ů, ď, ť, ň, č, š, ž, ý, á, é, í, ó, ú, ň
  cs: /[řůďťňčšžýáéíóúůň]/i,
  // Slovak: ľ, ť, ď, ň, ô, ä, í
  sk: /[ľťďňôä]/i,
  // Polish: ł, ń, ó, ś, ź, ż, ć, ę, ą
  pl: /[łńóśźżćęą]/i,
  // Hungarian: ő, ű
  hu: /[őű]/i,
  // Romanian: ă, â, î, ș, ț
  ro: /[ăâîșț]/i,
  // Croatian/Serbian Latin: đ, č, ć, ž, š
  hr: /[đčćžš]/i,
  // Turkish: ı, ö, ü, ğ, ş, ç
  tr: /[ıöüğşç]/i,
  // French: à, â, ç, é, è, ê, ë, î, ï, ô, ù, û, û, Ÿ, œ, æ
  fr: /[àâçéèêëîïôùûûÿœæ]/i,
  // Spanish: á, é, í, ó, ú, ñ, ü, ¡, ¿
  es: /[áéíóúñü¡¿]/i,
  // Portuguese: á, à, â, ã, é, ê, í, ó, ô, õ, ú, ç
  pt: /[áàâãéêíóôõúç]/i,
  // German: ä, ö, ü, ß
  de: /[äöüß]/i,
  // Dutch: ij
  nl: /[ij]/i,
  // Catalan: ç, l·l, à, è, é, í, ó, ú
  ca: /[çàèéíóú]/i,
  // Irish: á, é, í, ó, ú, fada marks
  ga: /[áéíóú]/i,
  // Vietnamese: ă, â, đ, ê, ô, ơ, ư (Vietnamese diacritics)
  vi: /[ăâđêôơư]/i,
  // Icelandic: á, é, í, ó, ú, ý, þ, ð, æ, ö
  is: /[áéíóúýþðæö]/i,
  // Maltese: ċ, ġ, għ, ż, z
  mt: /[ċġż]/i,
  // Breton: â, ê, î, ô, û, c'h
  br: /[âêîôû]/i,
  // Welsh: ŵ, ŷ
  cy: /[ŵŷ]/i,
});

/**
 * Diacritics-based strategy: detects language from unique diacritic patterns.
 * Works for single words. Returns undefined if no language-specific diacritics found.
 */
export class DiacriticsStrategy implements LanguageDetectionStrategy {
  readonly name = "diacritics";

  detect(text: string, candidates: string[]): string | undefined {
    for (const candidate of candidates) {
      const pattern = DIACRITIC_PATTERNS[candidate];
      if (pattern?.test(text)) {
        return candidate;
      }
    }
    return undefined;
  }
}

// ============================================================================
// Strategy 4: Wiktionary-based detection (definitive, requires DB)
// ============================================================================

/**
 * Wiktionary-based strategy: checks if word exists in dictionary.
 * Returns first candidate where word is found in Wiktionary data.
 * Most accurate for single words like "kocour" (Czech) vs English.
 */
export class WiktionaryStrategy implements LanguageDetectionStrategy {
  readonly name = "wiktionary";
  private readonly lookup: (word: string, langCode: string) => Promise<DictionaryContext | undefined>;

  constructor(lookup: (word: string, langCode: string) => Promise<DictionaryContext | undefined>) {
    this.lookup = lookup;
  }

  async detect(text: string, candidates: string[]): Promise<string | undefined> {
    const word = text.trim().toLowerCase();
    if (!word || word.includes(" ")) return undefined; // Single word only

    // Check each candidate language
    for (const candidate of candidates) {
      const context = await this.lookup(word, candidate);
      if (context) {
        return candidate;
      }
    }

    return undefined;
  }
}

// ============================================================================
// Strategy 5: AI-based detection (last resort, expensive)
// ============================================================================

export type AIGenerateFn = (prompt: string) => Promise<string>;

/**
 * AI-based strategy: uses language model to detect language.
 * Most flexible but slowest and most expensive.
 * Called only when all other strategies fail.
 */
export class AIStrategy implements LanguageDetectionStrategy {
  readonly name = "ai";
  private readonly generate: AIGenerateFn;

  constructor(generate: AIGenerateFn) {
    this.generate = generate;
  }

  async detect(text: string, candidates: string[]): Promise<string | undefined> {
    if (candidates.length <= 1) return undefined; // No need for AI with single candidate

    const candidatesStr = candidates.join(", ");
    const prompt = `Detect the language of this text from these candidates: ${candidatesStr}.
Text: "${text}"
Respond with ONLY the ISO 639-1 language code (candidatesStr). No explanation.`;

    try {
      const response = await this.generate(prompt);
      const detected = response.trim().toLowerCase().substring(0, 2);
      if (candidates.includes(detected)) {
        return detected;
      }
    } catch {
      // AI failed, return undefined
    }

    return undefined;
  }
}

// ============================================================================
// Backward-compatible API (detects "kocour" correctly)
// ============================================================================

// Legacy placeholder — kept to avoid breaking external imports. Actual mapping
// lives in ISO1_TO_ISO3 above. Remove this comment block when external code
// no longer references _ISO1_TO_ISO3_LEGACY.
const _ISO1_TO_ISO3_LEGACY: Readonly<Record<string, string>> = ISO1_TO_ISO3;

/**
 * Detect the language of input text from a set of candidate languages.
 *
 * Detection chain (fastest to slowest):
 * 1. Script detection — works for any text, distinguishes by Unicode script
 * 2. Diacritics detection — unique diacritics (č, ř, ů for Czech, etc.)
 * 3. Franc detection — statistical, best for 3+ words
 * 4. Wiktionary (async) — definitive if word exists in dictionary
 * 5. AI (async) — last resort for ambiguous cases
 *
 * @param text - Input text to detect language for
 * @param candidates - ISO 639-1 language codes to consider
 * @returns Detected ISO 639-1 code, or undefined if inconclusive
 *
 * @example
 * detectLanguage("kocour", ["en", "cs"]) // → "cs" (diacritics: ǒ)
 * detectLanguage("hello", ["en", "ru"])  // → "en" (script only)
 */
export function detectLanguage(text: string, candidates: string[]): string | undefined {
  const trimmed = text.trim();

  // Empty or whitespace-only text
  if (trimmed.length === 0) return undefined;

  // No candidates
  if (candidates.length === 0) return undefined;

  // Single candidate — return it if text has letters
  if (candidates.length === 1) {
    return /\p{L}/u.test(trimmed) ? candidates[0] : undefined;
  }

  // Run sync strategies
  const scriptStrategy = new ScriptStrategy();
  const diacriticsStrategy = new DiacriticsStrategy();
  const francStrategy = new FrancStrategy();

  // 1. Script detection
  const scriptResult = scriptStrategy.detect(trimmed, candidates);
  if (scriptResult !== undefined) return scriptResult;

  // 2. Diacritics detection (catches "kocour" → Czech)
  const diacriticsResult = diacriticsStrategy.detect(trimmed, candidates);
  if (diacriticsResult !== undefined) return diacriticsResult;

  // 3. Franc detection (for longer texts)
  const francResult = francStrategy.detect(trimmed, candidates);
  if (francResult !== undefined) return francResult;

  // All strategies failed
  return undefined;
}

/**
 * Async version of detectLanguage that also tries Wiktionary and AI.
 * Use this when you have access to context lookup and AI.
 */
export async function detectLanguageAsync(
  text: string,
  candidates: string[],
  deps: {
    contextLookup?: (word: string, langCode: string) => Promise<DictionaryContext | undefined>;
    aiGenerate?: AIGenerateFn;
  },
): Promise<string | undefined> {
  const trimmed = text.trim();

  if (trimmed.length === 0) return undefined;
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) {
    return /\p{L}/u.test(trimmed) ? candidates[0] : undefined;
  }

  const scriptStrategy = new ScriptStrategy();
  const diacriticsStrategy = new DiacriticsStrategy();
  const francStrategy = new FrancStrategy();

  // Sync strategies first
  const scriptResult = scriptStrategy.detect(trimmed, candidates);
  if (scriptResult !== undefined) return scriptResult;

  const diacriticsResult = diacriticsStrategy.detect(trimmed, candidates);
  if (diacriticsResult !== undefined) return diacriticsResult;

  const francResult = francStrategy.detect(trimmed, candidates);
  if (francResult !== undefined) return francResult;

  // 4. Wiktionary lookup
  if (deps.contextLookup) {
    const wiktionaryStrategy = new WiktionaryStrategy(deps.contextLookup);
    const wiktionaryResult = await wiktionaryStrategy.detect(trimmed, candidates);
    if (wiktionaryResult !== undefined) return wiktionaryResult;
  }

  // 5. AI fallback
  if (deps.aiGenerate) {
    const aiStrategy = new AIStrategy(deps.aiGenerate);
    const aiResult = await aiStrategy.detect(trimmed, candidates);
    if (aiResult !== undefined) return aiResult;
  }

  return undefined;
}

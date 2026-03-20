import { franc } from "franc";

/**
 * Mapping from ISO 639-1 (2-letter) to ISO 639-3 (3-letter) codes.
 * franc uses ISO 639-3 internally.
 */
const ISO1_TO_ISO3: Record<string, string> = {
  en: "eng",
  cs: "ces",
  ru: "rus",
  uk: "ukr",
  de: "deu",
  fr: "fra",
  es: "spa",
  it: "ita",
  pt: "por",
  pl: "pol",
  nl: "nld",
  sv: "swe",
  da: "dan",
  no: "nob",
  fi: "fin",
  ja: "jpn",
  zh: "cmn",
  ko: "kor",
  ar: "arb",
  hi: "hin",
  tr: "tur",
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
};

/** Inverse mapping: ISO 639-3 → ISO 639-1 */
const ISO3_TO_ISO1: Record<string, string> = {};
for (const [iso1, iso3] of Object.entries(ISO1_TO_ISO3)) {
  ISO3_TO_ISO1[iso3] = iso1;
}

/**
 * Unicode script ranges for heuristic detection of short texts.
 */
type ScriptId = "cyrillic" | "latin" | "cjk" | "arabic" | "devanagari" | "greek" | "hangul" | "kana";

/** Check if a codepoint belongs to a known script */
function classifyCodePoint(cp: number): ScriptId | undefined {
  // Cyrillic (Basic + Supplement + Extended)
  if ((cp >= 0x0400 && cp <= 0x04ff) || (cp >= 0x0500 && cp <= 0x052f)) return "cyrillic";
  // Latin (Basic + Extended A/B + Supplement)
  if (
    (cp >= 0x0041 && cp <= 0x024f) ||
    (cp >= 0x1e00 && cp <= 0x1eff) ||
    (cp >= 0x0100 && cp <= 0x017f) || // Extended-A (diacritics like ř, ž, č)
    (cp >= 0x0180 && cp <= 0x024f)    // Extended-B
  ) return "latin";
  // CJK Unified Ideographs
  if (cp >= 0x4e00 && cp <= 0x9fff) return "cjk";
  // Arabic
  if (cp >= 0x0600 && cp <= 0x06ff) return "arabic";
  // Devanagari
  if (cp >= 0x0900 && cp <= 0x097f) return "devanagari";
  // Greek
  if (cp >= 0x0370 && cp <= 0x03ff) return "greek";
  // Hangul (Korean)
  if (cp >= 0xac00 && cp <= 0xd7af) return "hangul";
  // Hiragana + Katakana (Japanese kana)
  if ((cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff)) return "kana";
  return undefined;
}

/** Map scripts to the languages that use them (ISO 639-1) */
const SCRIPT_TO_LANGS: Record<ScriptId, string[]> = {
  cyrillic: ["ru", "uk", "bg", "sr"],
  latin: ["en", "cs", "de", "fr", "es", "it", "pt", "pl", "nl", "sv", "da", "no", "fi", "tr", "hu", "ro", "hr", "sk", "sl", "lt", "lv", "et"],
  cjk: ["zh", "ja"],
  arabic: ["ar"],
  devanagari: ["hi"],
  greek: ["el"],
  hangul: ["ko"],
  kana: ["ja"],
};

/**
 * Detect the dominant script of a text string.
 * Returns the script that has the most classified characters.
 */
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
 * Count the number of words in a text.
 * Words are whitespace-separated non-empty tokens.
 */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Detect the language of input text from a set of candidate languages.
 *
 * Uses `franc` (trigram-based detection) for texts with 3+ words,
 * and script-based heuristics for short inputs (1–2 words) where
 * franc is unreliable.
 *
 * @param text - Input text to detect language for
 * @param candidates - ISO 639-1 language codes to consider (e.g. ["ru", "cs", "en"])
 * @returns Detected ISO 639-1 code if it matches a candidate, or undefined if inconclusive
 *
 * Pure function — no side effects.
 */
export function detectLanguage(text: string, candidates: string[]): string | undefined {
  const trimmed = text.trim();

  // Empty or whitespace-only text
  if (trimmed.length === 0) return undefined;

  // No candidates to match against
  if (candidates.length === 0) return undefined;

  // Only one candidate — always return it (if text looks like language at all)
  if (candidates.length === 1) {
    // Check the text has at least some letter characters
    if (/\p{L}/u.test(trimmed)) return candidates[0];
    return undefined;
  }

  const words = wordCount(trimmed);

  // For short inputs (1–2 words), franc is unreliable → use script heuristics
  if (words <= 2) {
    return detectByScript(trimmed, candidates);
  }

  // For longer texts, use franc with candidates filter
  return detectByFranc(trimmed, candidates);
}

/**
 * Script-based heuristic detection for short texts.
 * Detects the dominant script and narrows candidates to those using that script.
 * Returns a match only if exactly one candidate uses the detected script.
 */
function detectByScript(text: string, candidates: string[]): string | undefined {
  const script = detectScript(text);
  if (!script) return undefined;

  const scriptLangs = SCRIPT_TO_LANGS[script] ?? [];
  const matches = candidates.filter((c) => scriptLangs.includes(c));

  // Exactly one candidate matches the detected script → confident
  if (matches.length === 1) return matches[0];

  // Multiple candidates share the same script → ambiguous
  // (e.g., both "cs" and "en" use Latin — can't distinguish from script alone)
  return undefined;
}

/**
 * franc-based detection for longer texts (3+ words).
 * Uses the `only` option to limit detection to candidate languages.
 */
function detectByFranc(text: string, candidates: string[]): string | undefined {
  // Convert candidates from ISO 639-1 to ISO 639-3 for franc
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

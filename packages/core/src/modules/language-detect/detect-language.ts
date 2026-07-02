import { franc, francAll } from "franc";
import type { DictionaryContextCandidate } from "../context-enrichment/types.js";
import { findLettersOutsideAlphabet } from "./alphabets.js";
import type { DetectionEvidence, DetectionResult, FindWordLanguagesFn } from "./types.js";

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
  cyrillic: ["ru", "uk", "bg", "sr", "kk"],
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
  kk: "kaz",
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

/** Reverse of ISO1_TO_ISO3, built by inversion (no separate hardcoded table). */
const ISO3_TO_ISO1: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(ISO1_TO_ISO3).map(([iso1, iso3]) => [iso3, iso1])),
);

/** How far the global winner must beat the best in-set candidate to be "out of set". */
const OUT_OF_SET_MARGIN = 0.22;

/**
 * Detects when the text is confidently in a language OUTSIDE the user's candidate set.
 *
 * The closed-set detector (`detectLanguage`) can only ever return a candidate, so an input
 * in an unconfigured language (e.g. German for a user with ru/en/cs/kk) gets silently coerced
 * to the nearest allowed language. This runs an UNCONSTRAINED `francAll` pass — the signal the
 * closed-set path discards — and returns the out-of-set language so the caller can tell the
 * user it isn't selected instead of mistranslating.
 *
 * Conservative by design: requires ≥3 words (franc is unreliable below that) and a clear
 * margin over the best in-set candidate, so legitimate in-set input never trips it.
 *
 * @returns ISO 639-1 code of the out-of-set language, or undefined.
 */
export function detectOutOfSetLanguage(text: string, candidates: string[]): string | undefined {
  const trimmed = text.trim();
  if (wordCount(trimmed) < 3) return undefined;

  const candidateSet = new Set(candidates);
  const all = francAll(trimmed);
  const topIso3 = all[0]?.[0];
  const topIso1 = topIso3 ? ISO3_TO_ISO1[topIso3] : undefined;

  // Unknown language we can't name, or the global winner is already a candidate → fine.
  if (!topIso1 || candidateSet.has(topIso1)) return undefined;

  const bestInSet = Math.max(
    0,
    ...all.filter(([iso3]) => candidateSet.has(ISO3_TO_ISO1[iso3] ?? "")).map(([, score]) => score),
  );

  return 1 - bestInSet >= OUT_OF_SET_MARGIN ? topIso1 : undefined;
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
  nl: /ij/i,
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
 * Returns a language only when exactly one candidate contains the word.
 * Most accurate for single words like "kocour" (Czech) vs English.
 */
export class WiktionaryStrategy implements LanguageDetectionStrategy {
  readonly name = "wiktionary";
  private readonly lookup: (word: string, langCode: string) => Promise<DictionaryContextCandidate[]>;

  constructor(lookup: (word: string, langCode: string) => Promise<DictionaryContextCandidate[]>) {
    this.lookup = lookup;
  }

  async findMatches(text: string, candidates: string[]): Promise<string[]> {
    const word = text.trim().toLowerCase();
    if (!word || word.includes(" ")) return []; // Single word only

    const uniqueCandidates = [...new Set(candidates)];
    const lookups = await Promise.all(
      uniqueCandidates.map(async (candidate) => ({
        candidate,
        contexts: await this.lookup(word, candidate),
      })),
    );

    return lookups.filter(({ contexts }) => contexts.length > 0).map(({ candidate }) => candidate);
  }

  async detect(text: string, candidates: string[]): Promise<string | undefined> {
    const matches = await this.findMatches(text, candidates);
    return matches.length === 1 ? matches[0] : undefined;
  }
}

// ============================================================================
// Strategy 5: AI-based detection (last resort, expensive)
// ============================================================================

export type AIGenerateFn = (prompt: string) => Promise<string>;

/** AI answer that may name a language outside the candidate set. */
export interface AIOpenDetection {
  /** ISO 639-1 code the model identified */
  language: string;
  /** Whether the identified language is one of the offered candidates */
  inCandidates: boolean;
}

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

  /**
   * Open detection: the model prefers a candidate but may name a language
   * outside the set, so the caller can tell the user the language isn't
   * selected instead of coercing to the nearest candidate.
   */
  async detectOpen(text: string, candidates: string[]): Promise<AIOpenDetection | undefined> {
    if (candidates.length <= 1) return undefined; // No need for AI with single candidate

    const candidatesStr = candidates.join(", ");
    const prompt = `Detect the language of this text. Preferred candidates: ${candidatesStr}.
Text: "${text}"
Respond with ONLY an ISO 639-1 language code. Prefer a candidate when the text is plausible in it. If the text clearly belongs to a language outside the candidates, respond with that language's code instead. If the text is valid in multiple candidate languages and context does not disambiguate it, respond with "ambiguous". No explanation.`;

    try {
      const response = await this.generate(prompt);
      const raw = response.trim().toLowerCase();
      if (raw.startsWith("ambiguous")) return undefined;

      const detected = raw.substring(0, 2);
      if (!ISO1_TO_ISO3[detected]) return undefined; // not a code we can act on

      return { language: detected, inCandidates: candidates.includes(detected) };
    } catch {
      // AI failed, return undefined
      return undefined;
    }
  }

  async detect(text: string, candidates: string[]): Promise<string | undefined> {
    const open = await this.detectOpen(text, candidates);
    return open?.inCandidates ? open.language : undefined;
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
    contextLookup?: (word: string, langCode: string) => Promise<DictionaryContextCandidate[]>;
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
    const wiktionaryMatches = await wiktionaryStrategy.findMatches(trimmed, candidates);
    if (wiktionaryMatches.length === 1) return wiktionaryMatches[0];
    if (wiktionaryMatches.length > 1) return undefined;
  }

  // 5. AI fallback
  if (deps.aiGenerate) {
    const aiStrategy = new AIStrategy(deps.aiGenerate);
    const aiResult = await aiStrategy.detect(trimmed, candidates);
    if (aiResult !== undefined) return aiResult;
  }

  return undefined;
}

// ============================================================================
// Confidence-aware detection (Step 3 — conservative ensemble with scoring)
// ============================================================================

const CONFIDENCE_THRESHOLD = 0.7;
const MARGIN_THRESHOLD = 0.2;

/**
 * Scripts that map (nearly) one-to-one onto a language, so being the only
 * candidate of that script is decisive on its own. Latin and Cyrillic are
 * NOT here: hundreds of languages share them, so a sole candidate still
 * needs its alphabet confirmed (e.g. "Strohá" must not count as English).
 */
const NEAR_UNIQUE_SCRIPTS: ReadonlySet<ScriptId> = new Set(["hangul", "kana", "greek", "devanagari", "arabic", "cjk"]);

/** Zero-score evidence entry documenting an alphabet exclusion in the trail. */
function alphabetExclusionEvidence(text: string, candidate: string): DetectionEvidence {
  const outside = findLettersOutsideAlphabet(text, candidate);
  return {
    strategy: "alphabet",
    candidate,
    score: 0,
    reason: `contains "${outside.join('", "')}" not in ${candidate} alphabet`,
  };
}

function scoreSoleScriptCandidate(text: string, script: ScriptId, candidate: string): DetectionEvidence[] {
  if (NEAR_UNIQUE_SCRIPTS.has(script) || findLettersOutsideAlphabet(text, candidate).length === 0) {
    return [{ strategy: "script", candidate, score: 0.9, reason: `unique ${script} script candidate` }];
  }
  return [
    {
      strategy: "script",
      candidate,
      score: 0.3,
      reason: `sole ${script} candidate but text has letters outside ${candidate} alphabet`,
    },
    alphabetExclusionEvidence(text, candidate),
  ];
}

function scoreScript(text: string, candidates: string[]): DetectionEvidence[] {
  const script = detectScript(text);
  if (!script) return [];

  const scriptLangs = SCRIPT_TO_LANGS[script] ?? [];
  const matches = candidates.filter((c) => scriptLangs.includes(c));

  if (matches.length === 0) return [];

  if (matches.length === 1) {
    return scoreSoleScriptCandidate(text, script, matches[0]);
  }

  // Multiple candidates share the script — narrow via alphabet exclusion.
  const admissible = matches.filter((c) => findLettersOutsideAlphabet(text, c).length === 0);

  if (admissible.length === 1) {
    const excluded = matches.filter((c) => c !== admissible[0]);
    return [
      ...scoreSoleScriptCandidate(text, script, admissible[0]),
      ...excluded.map((c) => alphabetExclusionEvidence(text, c)),
    ];
  }

  // Safety valve: exclusion may not eliminate every candidate (loanwords,
  // mixed-script input) — keep the unfiltered set rather than none.
  const kept = admissible.length === 0 ? matches : admissible;
  return kept.map((c) => ({
    strategy: "script",
    candidate: c,
    score: 0.3,
    reason: `shared ${script} script with ${kept.length} candidates`,
  }));
}

/**
 * Non-ASCII characters per language, derived from DIACRITIC_PATTERNS so both
 * scoring paths share one source of truth. ASCII letters in a pattern (e.g.
 * the Dutch "ij" digraph) carry no diacritic signal and are dropped.
 */
const DIACRITIC_CHARS: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const map = new Map<string, ReadonlySet<string>>();
  for (const [lang, pattern] of Object.entries(DIACRITIC_PATTERNS)) {
    const chars = new Set<string>();
    for (const char of pattern.source) {
      const cp = char.codePointAt(0);
      if (cp !== undefined && cp > 0x7f) chars.add(char);
    }
    if (chars.size > 0) map.set(lang, chars);
  }
  return map;
})();

/** Diacritic character → languages whose pattern contains it. */
const DIACRITIC_CHAR_OWNERS: ReadonlyMap<string, readonly string[]> = (() => {
  const owners = new Map<string, string[]>();
  for (const [lang, chars] of DIACRITIC_CHARS) {
    for (const char of chars) {
      const list = owners.get(char) ?? [];
      list.push(lang);
      owners.set(char, list);
    }
  }
  return owners;
})();

const DIACRITIC_UNIQUE_SCORE = 0.8;
const DIACRITIC_SHARED_SCORE = 0.4;

/**
 * Scores candidates by diacritic evidence, weighted by how distinctive each
 * character actually is. A character owned by a single language (ř → cs,
 * ł → pl, ß → de) is near-conclusive; a widely shared one (á, é) is only a
 * mild hint — "unique among the user's candidates" is NOT unique in reality,
 * so it must not settle the detection on its own.
 */
function scoreDiacritics(text: string, candidates: string[]): DetectionEvidence[] {
  const lowered = text.normalize("NFC").toLowerCase();
  const evidence: DetectionEvidence[] = [];

  for (const candidate of candidates) {
    const chars = DIACRITIC_CHARS.get(candidate);
    if (!chars) continue;

    const matched = [...new Set([...lowered].filter((char) => chars.has(char)))];
    if (matched.length === 0) continue;

    const uniqueChar = matched.find((char) => (DIACRITIC_CHAR_OWNERS.get(char) ?? []).length === 1);
    if (uniqueChar) {
      evidence.push({
        strategy: "diacritics",
        candidate,
        score: DIACRITIC_UNIQUE_SCORE,
        reason: `"${uniqueChar}" occurs only in ${candidate}`,
      });
    } else {
      evidence.push({
        strategy: "diacritics",
        candidate,
        score: DIACRITIC_SHARED_SCORE,
        reason: `diacritics "${matched.join('", "')}" shared across languages`,
      });
    }
  }

  return evidence;
}

function scoreFranc(text: string, candidates: string[]): DetectionEvidence[] {
  if (wordCount(text) < 3) return [];

  const iso3Candidates: string[] = [];
  const iso3ToCandidate: Record<string, string> = {};
  for (const c of candidates) {
    const iso3 = ISO1_TO_ISO3[c];
    if (iso3) {
      iso3Candidates.push(iso3);
      iso3ToCandidate[iso3] = c;
    }
  }
  if (iso3Candidates.length === 0) return [];

  const detected = franc(text, { only: iso3Candidates });
  if (detected === "und") return [];

  const candidate = iso3ToCandidate[detected];
  if (candidate) {
    return [{ strategy: "franc", candidate, score: 0.7, reason: "statistical trigram match" }];
  }
  return [];
}

function aggregateScores(evidence: DetectionEvidence[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const entry of evidence) {
    scores.set(entry.candidate, (scores.get(entry.candidate) ?? 0) + entry.score);
  }
  return scores;
}

function buildResult(evidence: DetectionEvidence[]): DetectionResult {
  const scores = aggregateScores(evidence);
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    return { confidence: 0, evidence };
  }

  const [topCandidate, topScore] = sorted[0];
  const secondScore = sorted.length > 1 ? sorted[1][1] : 0;
  const confidence = Math.min(1, topScore);
  const margin = topScore - secondScore;

  if (confidence >= CONFIDENCE_THRESHOLD && margin >= MARGIN_THRESHOLD) {
    return { language: topCandidate, confidence, evidence };
  }

  return {
    confidence: 0,
    evidence,
    ambiguousCandidates: sorted.map(([candidate]) => candidate),
  };
}

function hasNonAsciiLatinLetter(text: string): boolean {
  for (const char of text.normalize("NFC")) {
    const cp = char.codePointAt(0);
    if (cp !== undefined && cp > 0x7f && /\p{Script=Latin}/u.test(char)) return true;
  }
  return false;
}

/**
 * Whether a confident sync detection still needs dictionary confirmation.
 *
 * True for a single word carrying non-ASCII Latin letters whose detection
 * rests solely on script/diacritics heuristics — the exact class where
 * "unique among candidates" goes wrong (e.g. Czech "Strohá" scored as Spanish
 * for a [ru, es] user because á is also a Spanish letter). Evidence from
 * dictionary, franc or AI already grounds the result, so no re-check then.
 */
export function needsDictionaryVerification(text: string, detection: DetectionResult): boolean {
  if (detection.language === undefined) return false;
  if (wordCount(text) !== 1) return false;
  if (!hasNonAsciiLatinLetter(text)) return false;
  return !detection.evidence.some(
    (entry) => entry.strategy === "wiktionary" || entry.strategy === "ai" || entry.strategy === "franc",
  );
}

function isEnglishOnlyLookupTooWeakForSharedScriptWord(
  text: string,
  evidence: readonly DetectionEvidence[],
  wiktionaryMatches: readonly string[],
): boolean {
  if (wordCount(text) !== 1 || wiktionaryMatches.length !== 1 || wiktionaryMatches[0] !== "en") {
    return false;
  }

  const sharedScriptCandidates = evidence
    .filter((entry) => entry.strategy === "script" && entry.score < CONFIDENCE_THRESHOLD)
    .map((entry) => entry.candidate);

  return sharedScriptCandidates.includes("en") && sharedScriptCandidates.length > 1;
}

export function detectLanguageWithConfidence(text: string, candidates: string[]): DetectionResult {
  const trimmed = text.trim();
  const uniqueCandidates = [...new Set(candidates)];

  if (trimmed.length === 0 || uniqueCandidates.length === 0) {
    return { confidence: 0, evidence: [] };
  }

  if (uniqueCandidates.length === 1) {
    if (/\p{L}/u.test(trimmed)) {
      return {
        language: uniqueCandidates[0],
        confidence: 1,
        evidence: [
          { strategy: "single-candidate", candidate: uniqueCandidates[0], score: 1, reason: "only candidate" },
        ],
      };
    }
    return { confidence: 0, evidence: [] };
  }

  const evidence: DetectionEvidence[] = [
    ...scoreScript(trimmed, uniqueCandidates),
    ...scoreDiacritics(trimmed, uniqueCandidates),
    ...scoreFranc(trimmed, uniqueCandidates),
  ];

  return buildResult(evidence);
}

/** Adds dictionary-match evidence using the shared wiktionary scoring rules. */
function pushWiktionaryEvidence(text: string, evidence: DetectionEvidence[], matches: readonly string[]): void {
  if (matches.length === 1) {
    if (!isEnglishOnlyLookupTooWeakForSharedScriptWord(text, evidence, matches)) {
      evidence.push({
        strategy: "wiktionary",
        candidate: matches[0],
        score: 0.9,
        reason: "unique dictionary match",
      });
    }
  } else if (matches.length > 1) {
    for (const candidate of matches) {
      evidence.push({
        strategy: "wiktionary",
        candidate,
        score: 0.3,
        reason: "word exists in multiple candidate dictionaries",
      });
    }
  }
}

export async function detectLanguageWithConfidenceAsync(
  text: string,
  candidates: string[],
  deps: {
    contextLookup?: (word: string, langCode: string) => Promise<DictionaryContextCandidate[]>;
    aiGenerate?: AIGenerateFn;
    findWordLanguages?: FindWordLanguagesFn;
  },
): Promise<DetectionResult> {
  const trimmed = text.trim();
  const uniqueCandidates = [...new Set(candidates)];

  if (trimmed.length === 0 || uniqueCandidates.length === 0) {
    return { confidence: 0, evidence: [] };
  }

  if (uniqueCandidates.length === 1) {
    if (/\p{L}/u.test(trimmed)) {
      return {
        language: uniqueCandidates[0],
        confidence: 1,
        evidence: [
          { strategy: "single-candidate", candidate: uniqueCandidates[0], score: 1, reason: "only candidate" },
        ],
      };
    }
    return { confidence: 0, evidence: [] };
  }

  const evidence: DetectionEvidence[] = [
    ...scoreScript(trimmed, uniqueCandidates),
    ...scoreDiacritics(trimmed, uniqueCandidates),
    ...scoreFranc(trimmed, uniqueCandidates),
  ];

  const earlyResult = buildResult(evidence);
  const verifying = deps.findWordLanguages !== undefined && needsDictionaryVerification(trimmed, earlyResult);
  if (earlyResult.language !== undefined && !verifying) {
    return earlyResult;
  }

  if (deps.findWordLanguages && wordCount(trimmed) === 1) {
    // Dictionary sweep across ALL supported languages — the strongest signal
    // for a single word, and the only one that can spot an out-of-set language.
    let dictLangs: string[] = [];
    try {
      dictLangs = await deps.findWordLanguages(trimmed);
    } catch {
      dictLangs = []; // fail-open: sweep must never block detection
    }

    const candidateSet = new Set(uniqueCandidates);
    const candidateMatches = uniqueCandidates.filter((c) => dictLangs.includes(c));
    const outOfSet = dictLangs.filter((c) => !candidateSet.has(c));

    if (candidateMatches.length === 0 && outOfSet.length > 0) {
      return {
        confidence: 0,
        evidence: [
          ...evidence,
          {
            strategy: "dictionary-sweep",
            candidate: outOfSet[0],
            score: 0,
            reason: `word found only in non-candidate dictionaries: ${outOfSet.join(", ")}`,
          },
        ],
        outOfSetLanguages: outOfSet,
      };
    }

    pushWiktionaryEvidence(trimmed, evidence, candidateMatches);
  } else if (deps.contextLookup) {
    const wiktionaryStrategy = new WiktionaryStrategy(deps.contextLookup);
    const wiktionaryMatches = await wiktionaryStrategy.findMatches(trimmed, uniqueCandidates);
    pushWiktionaryEvidence(trimmed, evidence, wiktionaryMatches);
  }

  const postWiktionaryResult = buildResult(evidence);
  if (postWiktionaryResult.language !== undefined) {
    return postWiktionaryResult;
  }

  if (deps.aiGenerate) {
    const aiStrategy = new AIStrategy(deps.aiGenerate);
    const aiResult = await aiStrategy.detectOpen(trimmed, uniqueCandidates);
    if (aiResult?.inCandidates) {
      evidence.push({ strategy: "ai", candidate: aiResult.language, score: 0.6, reason: "AI language identification" });
    } else if (aiResult) {
      return {
        confidence: 0,
        evidence: [
          ...evidence,
          { strategy: "ai", candidate: aiResult.language, score: 0, reason: "AI identified a non-candidate language" },
        ],
        outOfSetLanguages: [aiResult.language],
      };
    }
  }

  return buildResult(evidence);
}

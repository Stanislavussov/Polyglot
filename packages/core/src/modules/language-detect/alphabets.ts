/**
 * Per-language alphabets for negative-evidence detection (lingua-style rule engine).
 *
 * A letter found in the input but absent from a candidate's alphabet is strong
 * evidence AGAINST that candidate (e.g. "á" rules out English). Languages
 * without an entry here can never be excluded, so alphabets err on the side of
 * over-inclusion: a superfluous letter merely skips an exclusion, while a
 * missing one wrongly vetoes a valid language. All Latin alphabets therefore
 * keep the full a–z base (loanwords, foreign proper names).
 */

const LATIN_BASE = "abcdefghijklmnopqrstuvwxyz";
/** Russian alphabet: а–я plus ё. */
const CYRILLIC_RU = "абвгдежзийклмнопрстуфхцчшщъыьэюяё";

function toSet(letters: string): ReadonlySet<string> {
  return Object.freeze(new Set(letters.normalize("NFC")));
}

const ALPHABETS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  en: toSet(LATIN_BASE),
  cs: toSet(`${LATIN_BASE}áčďéěíňóřšťúůýž`),
  sk: toSet(`${LATIN_BASE}áäčďéíĺľňóôŕšťúýž`),
  de: toSet(`${LATIN_BASE}äöüß`),
  fr: toSet(`${LATIN_BASE}àâæçéèêëîïôœùûüÿ`),
  es: toSet(`${LATIN_BASE}áéíóúñü`),
  it: toSet(`${LATIN_BASE}àèéìíîòóùú`),
  pt: toSet(`${LATIN_BASE}áàâãçéêíóôõúü`),
  pl: toSet(`${LATIN_BASE}ąćęłńóśźż`),
  hu: toSet(`${LATIN_BASE}áéíóöőúüű`),
  ro: toSet(`${LATIN_BASE}ăâîșțşţ`),
  hr: toSet(`${LATIN_BASE}čćđšž`),
  tr: toSet(`${LATIN_BASE}çğıöşüâîû`),
  nl: toSet(`${LATIN_BASE}áéèëïöü`),
  sv: toSet(`${LATIN_BASE}åäöé`),
  da: toSet(`${LATIN_BASE}æøåé`),
  no: toSet(`${LATIN_BASE}æøåé`),
  fi: toSet(`${LATIN_BASE}äöå`),
  sl: toSet(`${LATIN_BASE}čšž`),
  lt: toSet(`${LATIN_BASE}ąčęėįšųūž`),
  lv: toSet(`${LATIN_BASE}āčēģīķļņšūž`),
  et: toSet(`${LATIN_BASE}äöõüšž`),
  ru: toSet(CYRILLIC_RU),
  uk: toSet("абвгґдеєжзиіїйклмнопрстуфхцчшщьюя"),
  bg: toSet("абвгдежзийклмнопрстуфхцчшщъьюя"),
  sr: toSet("абвгдђежзијклљмнњопрстћуфхцчџш"),
  kk: toSet(`${CYRILLIC_RU}әғқңөұүһі`),
});

/**
 * Alphabet (lowercase NFC letters) of a language, or undefined when unknown.
 * Unknown languages can never be excluded by alphabet evidence.
 */
export function getAlphabet(lang: string): ReadonlySet<string> | undefined {
  return ALPHABETS[lang];
}

/** ISO 639-1 codes that carry alphabet data (usable for exclusion/detection). */
export function getAlphabetLanguages(): string[] {
  return Object.keys(ALPHABETS);
}

/**
 * Unique letters of `text` that do not belong to `lang`'s alphabet.
 *
 * Only Unicode letters count — digits, apostrophes, hyphens, punctuation and
 * whitespace are ignored. Input is NFC-normalized and lowercased, so
 * "STROHÁ" and "Strohá" report the same exclusion. An unknown language yields
 * an empty result (no negative evidence possible).
 */
export function findLettersOutsideAlphabet(text: string, lang: string): string[] {
  const alphabet = getAlphabet(lang);
  if (!alphabet) return [];

  const outside = new Set<string>();
  for (const char of text.normalize("NFC").toLowerCase()) {
    if (/\p{L}/u.test(char) && !alphabet.has(char)) {
      outside.add(char);
    }
  }
  return [...outside];
}

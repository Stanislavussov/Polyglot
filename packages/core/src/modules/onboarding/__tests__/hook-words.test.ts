/**
 * Hook-word list — behaviour spec (Task 72, slice 4).
 *
 * The list is the source of truth for the onboarding demo AND for the
 * re-engagement notification's preset layer, so what matters is not the literal
 * words but the guarantees both rely on: every supported learning language can
 * fill the onboarding keyboard and then keep a daily notification unique for a
 * month, no entry is a duplicate, every entry carries a category the copy can
 * key off, the first three keep their positions (live callbacks address a word
 * by index), and an unknown language degrades to "no hook words" rather than
 * throwing.
 */
import { describe, expect, it } from "vitest";
import type { HookWordCategory } from "../hook-words.js";
import { getHookWordLanguages, getHookWords } from "../hook-words.js";

/** The 11 interface languages, which are also the supported learning languages. */
const SUPPORTED_LANGS = ["en", "ru", "cs", "de", "fr", "es", "it", "pt", "uk", "pl", "kk"];

const CATEGORIES: HookWordCategory[] = ["untranslatable", "idiom", "quirk"];

describe("hook words", () => {
  it.each(SUPPORTED_LANGS)("can fill the onboarding keyboard for '%s'", (lang) => {
    expect(getHookWords(lang).length).toBeGreaterThanOrEqual(3);
  });

  it.each(SUPPORTED_LANGS)("holds a month of daily presets for '%s'", (lang) => {
    // The preset layer sends one a day to a user with no dictionary; fewer than
    // a month's worth means repeats before they have had time to come back.
    expect(getHookWords(lang).length).toBeGreaterThanOrEqual(30);
  });

  it.each(SUPPORTED_LANGS)("keeps the first three demo picks at their index for '%s'", (lang) => {
    // `onb:hook:<lang>:<index>` callbacks on live keyboards and cached demo
    // cards both address a word by position, so these three are pinned.
    const pinned: Record<string, string[]> = {
      en: ["serendipity", "it's not my cup of tea", "put up with"],
      ru: ["тоска", "бить баклуши", "давай"],
      cs: ["prozvonit", "chodit kolem horké kaše", "strč prst skrz krk"],
      de: ["Backpfeifengesicht", "verschlimmbessern", "doch"],
      fr: ["dépaysement", "avoir le cafard", "si"],
      es: ["sobremesa", "ser pan comido", "estrenar"],
      it: ["abbiocco", "in bocca al lupo", "magari"],
      pt: ["saudade", "engolir sapos", "cafezinho"],
      uk: ["вирій", "як кіт наплакав", "нівроку"],
      pl: ["kombinować", "bułka z masłem", "no"],
      kk: ["дастархан", "төбесі көкке жетті", "сәлеметсіз бе"],
    };

    expect(
      getHookWords(lang)
        .slice(0, 3)
        .map((hook) => hook.headword),
    ).toEqual(pinned[lang]);
  });

  it("covers every supported language and nothing else", () => {
    expect([...getHookWordLanguages()].sort()).toEqual([...SUPPORTED_LANGS].sort());
  });

  it("never repeats a headword within a language", () => {
    for (const lang of SUPPORTED_LANGS) {
      const headwords = getHookWords(lang).map((hook) => hook.headword);
      expect(new Set(headwords).size, `duplicate headword in '${lang}'`).toBe(headwords.length);
    }
  });

  it("gives every entry a non-empty headword and a known category", () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const hook of getHookWords(lang)) {
        expect(hook.headword.trim(), `empty headword in '${lang}'`).not.toBe("");
        expect(CATEGORIES, `unknown category in '${lang}'`).toContain(hook.category);
      }
    }
  });

  it("returns an empty list for an unknown language instead of throwing", () => {
    expect(getHookWords("zz")).toEqual([]);
    expect(getHookWords("")).toEqual([]);
  });
});

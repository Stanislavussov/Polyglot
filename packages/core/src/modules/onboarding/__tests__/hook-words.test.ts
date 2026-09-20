/**
 * Hook-word list — behaviour spec (Task 72, slice 4).
 *
 * The list is the source of truth for the onboarding demo AND for the
 * re-engagement notification's preset layer, so what matters is not the literal
 * words but the guarantees both rely on: every supported learning language can
 * fill the onboarding keyboard and then keep a daily notification unique for two
 * months, the pool spreads across all four categories — including the livelier
 * idiom and slang ones a lapsed user is here for — no entry is a duplicate,
 * every entry carries a category the copy can key off, the first three keep
 * their positions (live callbacks address a word by index), and an unknown
 * language degrades to "no hook words" rather than throwing.
 *
 * There is deliberately no assertion about *where* in the list a category sits.
 * An earlier revision pinned idioms and slang to positions 6-18 so a lapsed user
 * would reach them "within weeks, not months", which was true while the preset
 * picker walked this list in order. It now serves a per-user permutation of the
 * whole pool, so every entry is equally reachable from the first send and the
 * position rule would assert a mechanism that no longer exists.
 */
import { describe, expect, it } from "vitest";
import type { HookWordCategory } from "../hook-words.js";
import { getHookWordLanguages, getHookWords } from "../hook-words.js";

/** The 11 interface languages, which are also the supported learning languages. */
const SUPPORTED_LANGS = ["en", "ru", "cs", "de", "fr", "es", "it", "pt", "uk", "pl", "kk"];

const CATEGORIES: HookWordCategory[] = ["untranslatable", "idiom", "quirk", "slang"];

describe("hook words", () => {
  it.each(SUPPORTED_LANGS)("can fill the onboarding keyboard for '%s'", (lang) => {
    expect(getHookWords(lang).length).toBeGreaterThanOrEqual(3);
  });

  it.each(SUPPORTED_LANGS)("holds two months of daily presets for '%s'", (lang) => {
    // The preset layer sends one a day to a user with no dictionary, and its
    // de-dup memory now spans the full retained history — so the pool, not the
    // window, is what decides how long it takes to come back around.
    expect(getHookWords(lang).length).toBeGreaterThanOrEqual(70);
  });

  it.each(SUPPORTED_LANGS)("spreads across every category for '%s'", (lang) => {
    // A pool that is all earnest untranslatable nouns reads as one note however
    // long it is, and these notifications go to users who have already seen the
    // opening set. Current slang is the half no dictionary covers.
    const present = new Set(getHookWords(lang).map((hook) => hook.category));

    expect([...present].sort()).toEqual([...CATEGORIES].sort());
  });

  it.each(SUPPORTED_LANGS)("carries a real share of idioms and slang for '%s'", (lang) => {
    // Presence of a category is not enough: one token slang entry in eighty
    // leaves the pool reading as the earnest original set. Kazakh keeps a lower
    // slang floor — there is no curated set we can verify further.
    const words = getHookWords(lang);
    const count = (category: string) => words.filter((hook) => hook.category === category).length;

    expect(count("idiom")).toBeGreaterThanOrEqual(20);
    expect(count("slang")).toBeGreaterThanOrEqual(lang === "kk" ? 6 : 10);
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

  it("has no headword that differs from another only in case or punctuation", () => {
    // The notification de-dup compares exact strings, so `low-key` and `lowkey`
    // are two entries to the pool and one word to the reader — it arrives twice
    // and reads as the repetition this list exists to avoid. Merging two
    // curation passes is how such a pair gets in.
    for (const lang of SUPPORTED_LANGS) {
      const byShape = new Map<string, string[]>();
      for (const { headword } of getHookWords(lang)) {
        const shape = headword.toLowerCase().replaceAll(/[\s\-']/g, "");
        byShape.set(shape, [...(byShape.get(shape) ?? []), headword]);
      }
      const collisions = [...byShape.values()].filter((spellings) => spellings.length > 1);

      expect(collisions, `same word spelled two ways in '${lang}'`).toEqual([]);
    }
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

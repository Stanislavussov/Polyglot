/**
 * Hook-word list — behaviour spec (Task 72, slice 4).
 *
 * The list is the source of truth for the onboarding demo, so what matters is
 * not the literal words but the guarantees the onboarding screen relies on:
 * every supported learning language can fill a three-button keyboard, no button
 * is a duplicate, every entry carries a category the copy can key off, and an
 * unknown language degrades to "no hook words" instead of throwing.
 */
import { describe, expect, it } from "vitest";
import type { HookWordCategory } from "../hook-words.js";
import { getHookWordLanguages, getHookWords } from "../hook-words.js";

/** The 11 interface languages, which are also the supported learning languages. */
const SUPPORTED_LANGS = ["en", "ru", "cs", "de", "fr", "es", "it", "pt", "uk", "pl", "kk"];

const CATEGORIES: HookWordCategory[] = ["untranslatable", "idiom", "quirk"];

describe("hook words", () => {
  it.each(SUPPORTED_LANGS)("offers exactly three hook words for '%s'", (lang) => {
    expect(getHookWords(lang)).toHaveLength(3);
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

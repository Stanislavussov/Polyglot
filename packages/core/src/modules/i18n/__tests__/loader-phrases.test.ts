/**
 * Loader phrases — the rotating "please wait" text shown while a translation or
 * a mentor turn runs. The loader speaks the languages the user is LEARNING, so
 * the wait doubles as exposure to the colloquial filler those languages use;
 * the interface-language keys are only the fallback for a user who has none.
 *
 * What matters: every variant is real text in its own language, the variants a
 * picker can draw within one stage are genuinely different strings (Telegram
 * rejects an edit that leaves the message unchanged), and a rendered line names
 * which language is speaking.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getSupportedLangs, t } from "../i18n.js";
import { initLanguageRegistry } from "../language-registry.js";
import {
  allLoaderPhraseKeys,
  composeLoaderText,
  hasWaitPhrases,
  type LoaderKind,
  loaderEmoji,
  loaderPhraseKeys,
  loaderTextsFor,
  waitPhrases,
} from "../loader-phrases.js";

const KINDS: LoaderKind[] = ["translate", "mentor"];

/** The learning languages a user can pick — `is_supported` in the languages table. */
const LEARNABLE = getSupportedLangs();

beforeAll(() => {
  initLanguageRegistry(LEARNABLE.map((code) => ({ code, name: code, flag: `flag:${code}`, isSupported: true })));
});

describe("waitPhrases", () => {
  it("covers every language a user can choose to learn", () => {
    expect(LEARNABLE.filter((code) => !hasWaitPhrases(code))).toEqual([]);
  });

  it.each(LEARNABLE)("gives %s interchangeable variants that stage the wait", (code) => {
    const stages = [0, 1, 2].map((stage) => waitPhrases(code, stage));
    for (const variants of stages) {
      expect(variants.length).toBeGreaterThan(1);
    }
    // A repeated phrase across stages would stall the rotation on a long wait.
    const all = stages.flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("holds on the last stage once the wait outruns the list", () => {
    expect(waitPhrases("de", 3)).toEqual(waitPhrases("de", 2));
    expect(waitPhrases("de", 99)).toEqual(waitPhrases("de", 2));
  });

  it("returns nothing for a language it does not cover, so the caller can fall back", () => {
    expect(waitPhrases("ja", 0)).toEqual([]);
    expect(hasWaitPhrases("ja")).toBe(false);
  });

  it("phrases each language in that language, never in English", () => {
    const english = new Set(waitPhrases("en", 0).concat(waitPhrases("en", 1), waitPhrases("en", 2)));
    for (const code of LEARNABLE.filter((lang) => lang !== "en")) {
      const borrowed = [0, 1, 2].flatMap((stage) => waitPhrases(code, stage)).filter((p) => english.has(p));
      expect({ code, borrowed }).toEqual({ code, borrowed: [] });
    }
  });
});

describe("composeLoaderText", () => {
  it("names the speaking language with its flag", () => {
    expect(composeLoaderText("🧠", "de", "Moment mal")).toBe("🧠 flag:de Moment mal...");
  });

  it("drops the flag for a language the registry has none for", () => {
    initLanguageRegistry([{ code: "xx", name: "xx", isSupported: true }]);
    expect(composeLoaderText("🔤", "xx", "Hang on")).toBe("🔤 Hang on...");
    initLanguageRegistry(LEARNABLE.map((code) => ({ code, name: code, flag: `flag:${code}`, isSupported: true })));
  });
});

describe("loaderTextsFor", () => {
  it.each(KINDS)("renders %s lines for every glyph and variant of a stage", (kind) => {
    const lines = loaderTextsFor(kind, "es", 0);
    expect(lines).toHaveLength(loaderEmoji(kind).length * waitPhrases("es", 0).length);
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines.every((line) => line.includes("flag:es") && line.endsWith("..."))).toBe(true);
  });

  it("keeps the two kinds' glyphs apart, so the mode still reads at a glance", () => {
    expect(loaderEmoji("translate")).not.toEqual(loaderEmoji("mentor"));
    expect(loaderEmoji("mentor")[0]).toBe("🧠");
  });
});

describe("interface-language fallback", () => {
  it.each(KINDS)("gives %s several variants per stage", (kind) => {
    for (const stage of [0, 1, 2]) {
      expect(loaderPhraseKeys(kind, stage).length).toBeGreaterThan(1);
    }
    expect(loaderPhraseKeys(kind, 99)).toEqual(loaderPhraseKeys(kind, 2));
  });

  it.each(KINDS)("renders every %s fallback phrase in every interface language", (kind) => {
    for (const lang of getSupportedLangs()) {
      const texts = allLoaderPhraseKeys(kind).map((key) => t(key, lang));
      // A key missing from a locale falls back to the key name itself.
      expect(texts.every((text) => text.length > 0 && !text.startsWith("loader"))).toBe(true);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  it.each(KINDS)("translates every %s fallback phrase rather than reusing English", (kind) => {
    const keys = allLoaderPhraseKeys(kind);
    for (const lang of getSupportedLangs().filter((code) => code !== "en")) {
      const untranslated = keys.filter((key) => t(key, lang) === t(key, "en"));
      expect({ lang, untranslated }).toEqual({ lang, untranslated: [] });
    }
  });
});

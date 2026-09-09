/**
 * Loader phrases — the rotating "please wait" text shown while a translation or
 * a mentor turn runs. What matters is that every variant is real localized text
 * (a missing key silently degrades to English mid-wait) and that the variants a
 * picker can draw from within one stage are genuinely different strings, since
 * Telegram rejects an edit that leaves the message text unchanged.
 */
import { describe, expect, it } from "vitest";
import { getSupportedLangs, t } from "../i18n.js";
import { allLoaderPhraseKeys, type LoaderKind, loaderPhraseKeys } from "../loader-phrases.js";

const KINDS: LoaderKind[] = ["translate", "mentor"];

describe("loaderPhraseKeys", () => {
  it.each(KINDS)("gives %s several interchangeable variants per stage", (kind) => {
    for (const stage of [0, 1, 2]) {
      expect(loaderPhraseKeys(kind, stage).length).toBeGreaterThan(1);
    }
  });

  it.each(KINDS)("holds %s on the last stage once the wait outruns the list", (kind) => {
    const last = loaderPhraseKeys(kind, 2);
    expect(loaderPhraseKeys(kind, 3)).toEqual(last);
    expect(loaderPhraseKeys(kind, 99)).toEqual(last);
  });

  it.each(KINDS)("keeps the %s stages disjoint, so the text moves on every tick", (kind) => {
    const stages = [0, 1, 2].map((stage) => loaderPhraseKeys(kind, stage));
    const all = stages.flat();
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("loader phrase localization", () => {
  it.each(KINDS)("renders every %s phrase in every interface language", (kind) => {
    for (const lang of getSupportedLangs()) {
      const texts = allLoaderPhraseKeys(kind).map((key) => t(key, lang));
      // A key missing from a locale falls back to the key name itself.
      expect(texts.every((text) => text.length > 0 && !text.startsWith("loader"))).toBe(true);
      // Two variants that render identically would collapse the rotation.
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  it.each(KINDS)("translates every %s phrase rather than falling back to English", (kind) => {
    const keys = allLoaderPhraseKeys(kind);
    for (const lang of getSupportedLangs().filter((code) => code !== "en")) {
      const untranslated = keys.filter((key) => t(key, lang) === t(key, "en"));
      expect({ lang, untranslated }).toEqual({ lang, untranslated: [] });
    }
  });
});

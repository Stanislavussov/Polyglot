/**
 * Invariants for the curated starter-video catalogue.
 *
 * These guard the shape a human editor is most likely to break when adding an
 * entry — a malformed URL, a duplicate, a language quietly given one video — and
 * one product decision that looks like an omission and is not: Kazakh has no
 * entry on purpose.
 */
import { describe, expect, it } from "vitest";
import {
  getVideoSuggestionLanguages,
  getVideoSuggestions,
  getVideoSuggestionsForLangs,
  MAX_VIDEO_SUGGESTIONS,
  resolveVideoSuggestion,
} from "../video-suggestions.js";

/** `https://youtu.be/<11-char id>` — the only form the catalogue may use. */
const YOUTU_BE = /^https:\/\/youtu\.be\/[\w-]{11}$/;

describe("video suggestions — catalogue shape", () => {
  it("gives every listed language exactly two videos", () => {
    for (const lang of getVideoSuggestionLanguages()) {
      expect(getVideoSuggestions(lang), lang).toHaveLength(2);
    }
  });

  it("uses canonical short URLs everywhere", () => {
    for (const lang of getVideoSuggestionLanguages()) {
      for (const video of getVideoSuggestions(lang)) {
        expect(video.url, `${lang}: ${video.title}`).toMatch(YOUTU_BE);
      }
    }
  });

  it("never repeats a video", () => {
    const urls = getVideoSuggestionLanguages().flatMap((lang) => getVideoSuggestions(lang).map((v) => v.url));
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("names a title and a channel for every entry", () => {
    for (const lang of getVideoSuggestionLanguages()) {
      for (const video of getVideoSuggestions(lang)) {
        expect(video.title.trim().length, lang).toBeGreaterThan(0);
        expect(video.channel.startsWith("@"), `${lang}: ${video.channel}`).toBe(true);
      }
    }
  });

  it("has no Kazakh entry — YouTube cannot transcribe Kazakh", () => {
    // Not an oversight. YouTube has no Kazakh ASR model: its auto-tracks for
    // Kazakh videos come back as Russian, Turkish or Uzbek, so a `kk` entry would
    // feed the extractor a transcript in the wrong language and produce confident
    // nonsense. An empty screen is the better outcome until a video with
    // hand-written `kk` subtitles exists.
    expect(getVideoSuggestions("kk")).toEqual([]);
    expect(getVideoSuggestionLanguages()).not.toContain("kk");
  });

  it("returns nothing for a language it does not cover, rather than throwing", () => {
    expect(getVideoSuggestions("zz")).toEqual([]);
    expect(getVideoSuggestions("")).toEqual([]);
  });
});

describe("video suggestions — selection for a user", () => {
  it("represents every learning language before giving any language a second video", () => {
    const picked = getVideoSuggestionsForLangs(["de", "fr", "pl"]);

    expect(picked.slice(0, 3).map((v) => v.lang)).toEqual(["de", "fr", "pl"]);
  });

  it("caps the keyboard so a four-language user does not get a wall of buttons", () => {
    const picked = getVideoSuggestionsForLangs(["de", "fr", "pl", "it"]);

    expect(picked).toHaveLength(MAX_VIDEO_SUGGESTIONS);
  });

  it("skips a learning language with no verified videos", () => {
    const picked = getVideoSuggestionsForLangs(["kk", "de"]);

    expect(picked.every((v) => v.lang === "de")).toBe(true);
    expect(picked.length).toBeGreaterThan(0);
  });

  it("returns nothing when none of the learning languages is covered", () => {
    expect(getVideoSuggestionsForLangs(["kk"])).toEqual([]);
    expect(getVideoSuggestionsForLangs([])).toEqual([]);
  });

  it("round-trips the callback key back to the same video", () => {
    for (const picked of getVideoSuggestionsForLangs(["de", "pl"])) {
      expect(resolveVideoSuggestion(picked.lang, picked.index)?.url).toBe(picked.url);
    }
  });

  it("resolves nothing for a stale callback key", () => {
    expect(resolveVideoSuggestion("de", 99)).toBeNull();
    expect(resolveVideoSuggestion("kk", 0)).toBeNull();
  });
});

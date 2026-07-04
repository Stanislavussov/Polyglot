import { describe, expect, it } from "vitest";
import type { SessionData } from "../../types.js";
import { MAX_TRANSLATION_MAP_ENTRIES, setTranslationEntry } from "./translation-map.helper.js";

/** Minimal entry — only shape matters for eviction, not the payload. */
function entry(word: string): NonNullable<SessionData["translationMap"]>[string] {
  return {
    output: { sourceLang: "en", original: word } as NonNullable<SessionData["translationMap"]>[string]["output"],
    inputType: "word",
  };
}

describe("setTranslationEntry", () => {
  it("creates the map on first insert", () => {
    const session: SessionData = { activeMode: "idle" };
    setTranslationEntry(session, 100, entry("hello"));
    expect(Object.keys(session.translationMap ?? {})).toEqual(["100"]);
  });

  it("keeps entries below the cap without eviction", () => {
    const session: SessionData = { activeMode: "idle" };
    for (let i = 1; i <= 5; i++) {
      setTranslationEntry(session, i, entry(`w${i}`), 10);
    }
    expect(Object.keys(session.translationMap ?? {})).toHaveLength(5);
  });

  it("evicts the oldest (smallest message id) once the cap is exceeded", () => {
    const session: SessionData = { activeMode: "idle" };
    // Insert 3 with cap 2 → the first (id 1) is evicted.
    setTranslationEntry(session, 1, entry("first"), 2);
    setTranslationEntry(session, 2, entry("second"), 2);
    setTranslationEntry(session, 3, entry("third"), 2);

    const keys = Object.keys(session.translationMap ?? {});
    expect(keys).toHaveLength(2);
    expect(session.translationMap?.["1"]).toBeUndefined();
    expect(session.translationMap?.["2"]).toBeDefined();
    expect(session.translationMap?.["3"]).toBeDefined();
  });

  it("bounds the map to N keys after N + M inserts, evicting the oldest M", () => {
    const session: SessionData = { activeMode: "idle" };
    const cap = 4;
    const total = 10;
    for (let i = 1; i <= total; i++) {
      setTranslationEntry(session, i, entry(`w${i}`), cap);
    }

    const keys = Object.keys(session.translationMap ?? {}).map(Number);
    expect(keys).toHaveLength(cap);
    // Only the most-recent `cap` ids survive: 7, 8, 9, 10.
    expect(keys.sort((a, b) => a - b)).toEqual([7, 8, 9, 10]);
  });

  it("evicts by numeric id, not lexicographic order (id 9 is older than id 10)", () => {
    const session: SessionData = { activeMode: "idle" };
    setTranslationEntry(session, 9, entry("nine"), 1);
    setTranslationEntry(session, 10, entry("ten"), 1);

    // Lexicographically "10" < "9", but numerically 9 is the older card.
    expect(session.translationMap?.["9"]).toBeUndefined();
    expect(session.translationMap?.["10"]).toBeDefined();
  });

  it("defaults to MAX_TRANSLATION_MAP_ENTRIES when no cap is supplied", () => {
    const session: SessionData = { activeMode: "idle" };
    for (let i = 1; i <= MAX_TRANSLATION_MAP_ENTRIES + 5; i++) {
      setTranslationEntry(session, i, entry(`w${i}`));
    }
    expect(Object.keys(session.translationMap ?? {})).toHaveLength(MAX_TRANSLATION_MAP_ENTRIES);
  });

  it("overwrites an existing entry without growing the map", () => {
    const session: SessionData = { activeMode: "idle" };
    setTranslationEntry(session, 42, entry("v1"), 5);
    setTranslationEntry(session, 42, entry("v2"), 5);

    expect(Object.keys(session.translationMap ?? {})).toEqual(["42"]);
    expect(session.translationMap?.["42"]?.output.original).toBe("v2");
  });
});

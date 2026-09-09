import { describe, expect, it } from "vitest";
import type { SessionData } from "../../types.js";
import {
  MAX_CARD_WORD_ENTRIES,
  MAX_TRANSLATION_MAP_ENTRIES,
  recallCardWord,
  setTranslationEntry,
} from "./translation-map.helper.js";

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

  it("evicts by insertion recency, not message-id magnitude", () => {
    const session: SessionData = { activeMode: "idle" };
    // Insert the LARGER id first, then a smaller id. Recency (not id) must win:
    // the later insert (id 9) survives even though it is the smaller id.
    setTranslationEntry(session, 100, entry("big-old"), 1);
    setTranslationEntry(session, 9, entry("small-new"), 1);

    expect(session.translationMap?.["100"]).toBeUndefined();
    expect(session.translationMap?.["9"]).toBeDefined();
  });

  it("retains a freshly-added low-id card when the map holds stale high-id entries", () => {
    // Regression: a chat recreated (or a different bot sharing this session key)
    // restarts message ids at low numbers, so a new card's id can be smaller
    // than stale entries. The new card must NOT be evicted in the same call
    // that adds it — otherwise its inline buttons report "session expired".
    const session: SessionData = { activeMode: "idle" };
    const cap = 30;
    // Fill the map with 30 stale high-id cards (ids 4318..4405).
    for (let i = 0; i < cap; i++) {
      setTranslationEntry(session, 4318 + i * 3, entry(`stale${i}`), cap);
    }
    // Now translate in a low-id chat: the new card is id 603.
    setTranslationEntry(session, 603, entry("fresh"), cap);

    expect(Object.keys(session.translationMap ?? {})).toHaveLength(cap);
    expect(session.translationMap?.["603"]).toBeDefined();
    expect(session.translationMap?.["603"]?.output.original).toBe("fresh");
    // The evicted card is a stale one, not the freshly-added low id.
    expect(session.translationMap?.["4318"]).toBeUndefined();
  });

  it("purges legacy entries without a recency stamp before freshly-stamped ones", () => {
    const session: SessionData = { activeMode: "idle" };
    // Simulate a pre-existing map persisted before recency stamps existed.
    session.translationMap = {
      "5000": entry("legacy-a"),
      "5001": entry("legacy-b"),
    };
    // Two fresh (stamped) low-id inserts with cap 2 must push out both legacy
    // entries, even though the legacy ids are numerically larger.
    setTranslationEntry(session, 10, entry("fresh-a"), 2);
    setTranslationEntry(session, 11, entry("fresh-b"), 2);

    expect(session.translationMap?.["5000"]).toBeUndefined();
    expect(session.translationMap?.["5001"]).toBeUndefined();
    expect(session.translationMap?.["10"]).toBeDefined();
    expect(session.translationMap?.["11"]).toBeDefined();
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

describe("recallCardWord", () => {
  it("still knows the word of a card evicted from the translation map", () => {
    // The whole point of the second map: eviction downgrades a card from
    // "fully interactive" to "re-translatable", never to a dead button.
    const session: SessionData = { activeMode: "idle" };
    setTranslationEntry(session, 1, entry("Arbeit"), 1);
    setTranslationEntry(session, 2, entry("Haus"), 1);

    expect(session.translationMap?.["1"]).toBeUndefined();
    expect(recallCardWord(session, 1)?.word).toBe("Arbeit");
  });

  it("carries the card's context hint so the retry reproduces the same request", () => {
    const session: SessionData = { activeMode: "idle" };
    setTranslationEntry(session, 7, { ...entry("bank"), contextHint: "river" });

    expect(recallCardWord(session, 7)).toMatchObject({ word: "bank", contextHint: "river" });
  });

  it("returns nothing for a message that never carried a card", () => {
    const session: SessionData = { activeMode: "idle" };
    setTranslationEntry(session, 7, entry("bank"));

    expect(recallCardWord(session, 999)).toBeUndefined();
  });

  it("outlives the translation map by an order of magnitude, then evicts too", () => {
    const session: SessionData = { activeMode: "idle" };
    for (let i = 1; i <= MAX_CARD_WORD_ENTRIES + 1; i++) {
      setTranslationEntry(session, i, entry(`w${i}`));
    }

    expect(Object.keys(session.cardWords ?? {})).toHaveLength(MAX_CARD_WORD_ENTRIES);
    expect(recallCardWord(session, 1)).toBeUndefined();
    expect(recallCardWord(session, MAX_TRANSLATION_MAP_ENTRIES + 1)?.word).toBe(`w${MAX_TRANSLATION_MAP_ENTRIES + 1}`);
  });
});

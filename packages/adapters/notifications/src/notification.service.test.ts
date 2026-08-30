import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DictionaryWordPickerDeps, VocabEntry } from "./types.js";

const { mockLogger, mockChild } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockChild: vi.fn(() => mockLogger),
}));

vi.mock("@polyglot/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@polyglot/core")>()),
  getLogger: vi.fn(() => ({
    info: mockLogger.info,
    warn: mockLogger.warn,
    error: mockLogger.error,
    child: mockChild,
  })),
  // A15 — prompt + schema now live in core; the picker delegates to them.
  buildContextSentencePrompt: vi.fn((context: string, langs: string[]) => `PROMPT:${context}:${langs.join(",")}`),
  contextualSentenceSchema: { schema: true },
}));

import { createContextualWordPicker, createDictionaryWordPicker } from "./notification.service.js";

describe("pickDictionaryWord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  const mockVocabEntries: VocabEntry[] = [
    {
      id: 10,
      original: "house",
      emoji: "🏠",
      createdAt: new Date("2025-01-01"),
      translations: [
        { targetLangId: 1, text: "dům" },
        { targetLangId: 2, text: "Haus" },
      ],
    },
    {
      id: 20,
      original: "car",
      emoji: "🚗",
      createdAt: new Date("2025-01-05"),
      translations: [
        { targetLangId: 1, text: "auto" },
        { targetLangId: 2, text: "Auto" },
      ],
    },
    {
      id: 30,
      original: "book",
      emoji: null,
      createdAt: new Date("2025-01-10"),
      translations: [{ targetLangId: 1, text: "kniha" }],
    },
  ];

  const mockGetLangCode = vi.fn((id: number) => {
    const map: Record<number, string> = { 1: "cs", 2: "de" };
    return map[id];
  });

  function buildDeps(overrides: Partial<DictionaryWordPickerDeps> = {}): DictionaryWordPickerDeps {
    return {
      getUserVocabulary: vi.fn().mockResolvedValue(mockVocabEntries),
      getLangCode: mockGetLangCode,
      ...overrides,
    };
  }

  describe("de-dup and exhaustion", () => {
    it("never picks a word the user was recently sent", async () => {
      const service = createDictionaryWordPicker(buildDeps());

      const result = await service.pickDictionaryWord(1, ["house", "car"]);

      expect(result?.original).toBe("book");
    });

    it("reports exhaustion instead of repeating, so the caller can fall back to a preset", async () => {
      // Re-sending a word the user just saw is what makes a reminder read as
      // spam; the dictionary declines rather than recycling its own history.
      const service = createDictionaryWordPicker(buildDeps());

      const result = await service.pickDictionaryWord(1, ["house", "car", "book"]);

      expect(result).toBeNull();
    });

    it("reports exhaustion for a one-word dictionary already sent", async () => {
      const service = createDictionaryWordPicker(
        buildDeps({
          getUserVocabulary: vi.fn().mockResolvedValue([mockVocabEntries[0]]),
        }),
      );

      expect(await service.pickDictionaryWord(1, ["house"])).toBeNull();
    });
  });

  describe("difficulty weighting", () => {
    const rated = (original: string, difficulty: VocabEntry["difficulty"], id: number): VocabEntry => ({
      id,
      original,
      emoji: null,
      createdAt: new Date("2025-01-01"),
      difficulty,
      translations: [{ targetLangId: 1, text: `${original}-cs` }],
    });

    it("weights a hard word 3x over a normal one", async () => {
      // Pool [hard, normal] → tickets [3, 1], total 4. A roll of 0.5 lands at
      // 2 (inside hard's 3 tickets); 0.8 lands at 3.2 (normal's ticket).
      const service = createDictionaryWordPicker(
        buildDeps({
          getUserVocabulary: vi.fn().mockResolvedValue([rated("storm", "hard", 1), rated("cloud", "normal", 2)]),
        }),
      );

      vi.spyOn(Math, "random").mockReturnValue(0.5);
      expect((await service.pickDictionaryWord(1))?.original).toBe("storm");

      vi.spyOn(Math, "random").mockReturnValue(0.8);
      expect((await service.pickDictionaryWord(1))?.original).toBe("cloud");
    });

    it("treats an unrated word exactly like a normal one", async () => {
      // [hard, unrated] → tickets [3, 1]: the same 0.8 roll that picked the
      // normal word above picks the unrated one here.
      const unrated: VocabEntry = { ...rated("cloud", undefined, 2), difficulty: undefined };
      const service = createDictionaryWordPicker(
        buildDeps({
          getUserVocabulary: vi.fn().mockResolvedValue([rated("storm", "hard", 1), unrated]),
        }),
      );

      vi.spyOn(Math, "random").mockReturnValue(0.8);
      expect((await service.pickDictionaryWord(1))?.original).toBe("cloud");
    });

    it("never picks an easy word while hard/normal words remain", async () => {
      const service = createDictionaryWordPicker(
        buildDeps({
          getUserVocabulary: vi.fn().mockResolvedValue([rated("known", "easy", 1), rated("cloud", "normal", 2)]),
        }),
      );

      for (const roll of [0, 0.5, 0.999]) {
        vi.spyOn(Math, "random").mockReturnValue(roll);
        expect((await service.pickDictionaryWord(1))?.original).toBe("cloud");
      }
    });

    it("falls back to easy words when every hard/normal word was recently sent", async () => {
      const service = createDictionaryWordPicker(
        buildDeps({
          getUserVocabulary: vi.fn().mockResolvedValue([rated("known", "easy", 1), rated("cloud", "normal", 2)]),
        }),
      );

      expect((await service.pickDictionaryWord(1, ["cloud"]))?.original).toBe("known");
    });

    it("still suggests from an all-easy dictionary instead of going silent", async () => {
      const service = createDictionaryWordPicker(
        buildDeps({
          getUserVocabulary: vi.fn().mockResolvedValue([rated("known", "easy", 1), rated("seen", "easy", 2)]),
        }),
      );

      const result = await service.pickDictionaryWord(1);
      expect(["known", "seen"]).toContain(result?.original);
    });
  });

  describe("happy path", () => {
    it("returns a random word from candidates", async () => {
      const deps = buildDeps();
      const service = createDictionaryWordPicker(deps);

      const result = await service.pickDictionaryWord(1);

      expect(["house", "car", "book"]).toContain(result?.original);
    });

    it("includes translations resolved via getLangCode", async () => {
      const deps = buildDeps();
      const service = createDictionaryWordPicker(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result?.translations).toEqual({ cs: "dům", de: "Haus" });
    });

    it("uses entry emoji when available", async () => {
      const deps = buildDeps();
      const service = createDictionaryWordPicker(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result?.emoji).toBe("🏠");
    });

    it("falls back to book emoji when entry has no emoji", async () => {
      const singleEntry: VocabEntry[] = [
        {
          id: 30,
          original: "book",
          emoji: null,
          createdAt: new Date("2025-01-10"),
          translations: [{ targetLangId: 1, text: "kniha" }],
        },
      ];
      const deps = buildDeps({ getUserVocabulary: vi.fn().mockResolvedValue(singleEntry) });
      const service = createDictionaryWordPicker(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result?.emoji).toBe("📖");
    });

    it("includes source: 'srs' in the result", async () => {
      const deps = buildDeps();
      const service = createDictionaryWordPicker(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result?.source).toBe("srs");
    });

    it("includes translationDetails when synonyms are present", async () => {
      const entriesWithSynonyms: VocabEntry[] = [
        {
          id: 10,
          original: "house",
          emoji: "🏠",
          createdAt: new Date("2025-01-01"),
          translations: [
            { targetLangId: 1, text: "dům", synonyms: ["budova", "stavení"] },
            { targetLangId: 2, text: "Haus" },
          ],
        },
      ];
      const deps = buildDeps({ getUserVocabulary: vi.fn().mockResolvedValue(entriesWithSynonyms) });
      const service = createDictionaryWordPicker(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result?.translationDetails).toEqual({
        cs: { synonyms: ["budova", "stavení"] },
      });
    });

    it("omits translationDetails when no synonyms exist", async () => {
      const deps = buildDeps();
      const service = createDictionaryWordPicker(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result?.translationDetails).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("returns null when user has no vocabulary", async () => {
      const deps = buildDeps({ getUserVocabulary: vi.fn().mockResolvedValue([]) });
      const service = createDictionaryWordPicker(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result).toBeNull();
    });

    it("returns null when entry has no resolvable translations", async () => {
      const entryWithUnknownLang: VocabEntry[] = [
        {
          id: 99,
          original: "mystery",
          emoji: "❓",
          createdAt: new Date(),
          translations: [{ targetLangId: 999, text: "unknown" }],
        },
      ];
      const deps = buildDeps({
        getUserVocabulary: vi.fn().mockResolvedValue(entryWithUnknownLang),
        getLangCode: vi.fn().mockReturnValue(undefined),
      });
      const service = createDictionaryWordPicker(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result).toBeNull();
    });

    // Task 70 — never suggest entries translated as written for an unrecognized word.
    it("never selects an unverified entry", async () => {
      const entries: VocabEntry[] = [
        {
          id: 40,
          original: "stroha",
          emoji: "🌾",
          createdAt: new Date("2025-01-01"),
          unverified: true,
          translations: [{ targetLangId: 1, text: "sláma" }],
        },
        {
          id: 41,
          original: "house",
          emoji: "🏠",
          createdAt: new Date("2025-01-02"),
          translations: [{ targetLangId: 1, text: "dům" }],
        },
      ];
      const deps = buildDeps({ getUserVocabulary: vi.fn().mockResolvedValue(entries) });
      const service = createDictionaryWordPicker(deps);

      // Math.random is stubbed to 0 → index 0 would be the unverified entry if not filtered.
      const result = await service.pickDictionaryWord(1);

      expect(result?.original).toBe("house");
    });

    it("returns null when every entry is unverified", async () => {
      const entries: VocabEntry[] = [
        {
          id: 40,
          original: "stroha",
          emoji: "🌾",
          createdAt: new Date("2025-01-01"),
          unverified: true,
          translations: [{ targetLangId: 1, text: "sláma" }],
        },
      ];
      const deps = buildDeps({ getUserVocabulary: vi.fn().mockResolvedValue(entries) });
      const service = createDictionaryWordPicker(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result).toBeNull();
    });
  });

  describe("error handling", () => {
    it("returns null when getUserVocabulary throws", async () => {
      const deps = buildDeps({
        getUserVocabulary: vi.fn().mockRejectedValue(new Error("DB error")),
      });
      const service = createDictionaryWordPicker(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
        expect.stringContaining("failed to get user vocabulary"),
      );
    });
  });
});

describe("pickContextualWord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const langs = { nativeLang: "ru", learningLangs: ["en"] };

  it("delegates to the core prompt builder and returns a contextual word", async () => {
    const generateObject = vi.fn().mockResolvedValue({
      sentence: "Один кофе, пожалуйста.",
      translations: { ru: "Один кофе, пожалуйста.", en: "One coffee, please." },
    });
    const service = createContextualWordPicker({ generateObject, contextualModel: "openai/gpt-4o" });

    const result = await service.pickContextualWord(1, "ordering coffee", langs);

    expect(generateObject).toHaveBeenCalledWith("PROMPT:ordering coffee:ru,en", expect.anything(), "openai/gpt-4o", {
      userId: 1,
    });
    expect(result).toEqual({
      original: "Один кофе, пожалуйста.",
      emoji: "🎯",
      // The prompt writes the sentence in the first language it is given, so the
      // card can flag it like any other headword.
      sourceLang: "ru",
      translations: { ru: "Один кофе, пожалуйста.", en: "One coffee, please." },
      source: "contextual",
    });
  });

  it("returns null (and never calls AI) when no contextual model is configured", async () => {
    const generateObject = vi.fn();
    const service = createContextualWordPicker({ generateObject });

    const result = await service.pickContextualWord(1, "ordering coffee", langs);

    expect(result).toBeNull();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("returns null when AI generation fails", async () => {
    const generateObject = vi.fn().mockRejectedValue(new Error("AI down"));
    const service = createContextualWordPicker({ generateObject, contextualModel: "openai/gpt-4o" });

    const result = await service.pickContextualWord(1, "ordering coffee", langs);

    expect(result).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1 }),
      expect.stringContaining("AI generation failed"),
    );
  });
});

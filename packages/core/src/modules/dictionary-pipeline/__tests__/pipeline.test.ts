import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLogger } from "../../../logger.js";
import { createDictionaryPipeline } from "../pipeline.js";
import type { DictionaryPipelineDeps, DictionaryWordConfig, PipelineEntry } from "../types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeEntry(overrides: Partial<PipelineEntry> & { id: number }): PipelineEntry {
  return {
    original: `word-${overrides.id}`,
    sourceLangId: 1,
    sourceLangCode: "en",
    inputType: "word",
    emoji: "📝",
    createdAt: new Date("2025-01-01"),
    translations: [
      {
        targetLangCode: "cs",
        text: `překlad-${overrides.id}`,
        expressionType: null,
        equivalentNote: null,
        connotationWarning: null,
        details: {
          synonyms: [{ text: "syn" }],
          examples: [{ context: "neutral" as const, target: "example" }],
          alternatives: [],
        },
      },
    ],
    ...overrides,
  };
}

function makeDeps(entries: PipelineEntry[]): DictionaryPipelineDeps {
  return {
    findEntriesByUser: vi.fn().mockResolvedValue(entries),
  };
}

function makeConfig(overrides?: Partial<DictionaryWordConfig>): DictionaryWordConfig {
  return {
    selection: {
      strategy: "random",
      limit: 10,
      ...overrides?.selection,
    },
    presentation: {
      fields: {
        synonyms: true,
        examples: true,
        alternatives: true,
        equivalentNote: true,
        connotationWarning: true,
      },
      ...overrides?.presentation,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  setLogger(silentLogger);
});

describe("createDictionaryPipeline", () => {
  describe("empty dictionary", () => {
    it("returns empty result when user has no words", async () => {
      const deps = makeDeps([]);
      const pipeline = createDictionaryPipeline(deps);
      const result = await pipeline.run(42, makeConfig());

      expect(result.words).toEqual([]);
      expect(result.meta.totalInDictionary).toBe(0);
      expect(result.meta.selectedCount).toBe(0);
      expect(result.meta.strategy).toBe("random");
    });
  });

  describe("random strategy", () => {
    it("returns limit words from a pool", async () => {
      const entries = Array.from({ length: 20 }, (_, i) => makeEntry({ id: i + 1 }));
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "random", limit: 5 },
      });

      const result = await pipeline.run(42, config);

      expect(result.words).toHaveLength(5);
      expect(result.meta.totalInDictionary).toBe(20);
      expect(result.meta.selectedCount).toBe(5);
      expect(result.meta.strategy).toBe("random");
    });

    it("returns all words when pool is smaller than limit", async () => {
      const entries = [makeEntry({ id: 1 }), makeEntry({ id: 2 })];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "random", limit: 10 },
      });

      const result = await pipeline.run(42, config);

      expect(result.words).toHaveLength(2);
      expect(result.meta.selectedCount).toBe(2);
    });

    it("all returned words come from the pool", async () => {
      const entries = Array.from({ length: 15 }, (_, i) => makeEntry({ id: i + 1 }));
      const ids = new Set(entries.map((e) => e.id));
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "random", limit: 8 },
      });

      const result = await pipeline.run(42, config);

      for (const word of result.words) {
        expect(ids.has(word.id)).toBe(true);
      }
    });
  });

  describe("oldest_first strategy", () => {
    it("returns words sorted by createdAt ASC", async () => {
      const entries = [
        makeEntry({ id: 1, createdAt: new Date("2025-03-01") }),
        makeEntry({ id: 2, createdAt: new Date("2025-01-01") }),
        makeEntry({ id: 3, createdAt: new Date("2025-02-01") }),
      ];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "oldest_first", limit: 3 },
      });

      const result = await pipeline.run(42, config);

      expect(result.words.map((w) => w.id)).toEqual([2, 3, 1]);
    });
  });

  describe("newest_first strategy", () => {
    it("returns words sorted by createdAt DESC", async () => {
      const entries = [
        makeEntry({ id: 1, createdAt: new Date("2025-01-01") }),
        makeEntry({ id: 2, createdAt: new Date("2025-03-01") }),
        makeEntry({ id: 3, createdAt: new Date("2025-02-01") }),
      ];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "newest_first", limit: 3 },
      });

      const result = await pipeline.run(42, config);

      expect(result.words.map((w) => w.id)).toEqual([2, 3, 1]);
    });
  });

  describe("least_reviewed strategy", () => {
    it("returns word with 0 reviews before word with 5 reviews", async () => {
      const entries = [
        makeEntry({ id: 1, createdAt: new Date("2025-01-01") }),
        makeEntry({ id: 2, createdAt: new Date("2025-01-02") }),
        makeEntry({ id: 3, createdAt: new Date("2025-01-03") }),
      ];
      const reviewCounts = new Map<number, number>([
        [1, 5],
        [3, 2],
        // id: 2 has 0 reviews (not in map)
      ]);
      const deps: DictionaryPipelineDeps = {
        findEntriesByUser: vi.fn().mockResolvedValue(entries),
        getReviewCounts: vi.fn().mockResolvedValue(reviewCounts),
      };
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "least_reviewed", limit: 3 },
      });

      const result = await pipeline.run(42, config);

      // id:2 (0 reviews), id:3 (2 reviews), id:1 (5 reviews)
      expect(result.words.map((w) => w.id)).toEqual([2, 3, 1]);
    });

    it("uses oldest_first as tiebreaker when review counts are equal", async () => {
      const entries = [
        makeEntry({ id: 1, createdAt: new Date("2025-03-01") }),
        makeEntry({ id: 2, createdAt: new Date("2025-01-01") }),
        makeEntry({ id: 3, createdAt: new Date("2025-02-01") }),
      ];
      const deps: DictionaryPipelineDeps = {
        findEntriesByUser: vi.fn().mockResolvedValue(entries),
        getReviewCounts: vi.fn().mockResolvedValue(new Map()),
      };
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "least_reviewed", limit: 3 },
      });

      const result = await pipeline.run(42, config);

      // All have 0 reviews → tiebreaker by createdAt ASC
      expect(result.words.map((w) => w.id)).toEqual([2, 3, 1]);
    });

    it("works without getReviewCounts dep (treats all as 0)", async () => {
      const entries = [
        makeEntry({ id: 1, createdAt: new Date("2025-02-01") }),
        makeEntry({ id: 2, createdAt: new Date("2025-01-01") }),
      ];
      const deps: DictionaryPipelineDeps = {
        findEntriesByUser: vi.fn().mockResolvedValue(entries),
        // no getReviewCounts provided
      };
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "least_reviewed", limit: 2 },
      });

      const result = await pipeline.run(42, config);

      // All 0 reviews → oldest first
      expect(result.words.map((w) => w.id)).toEqual([2, 1]);
    });
  });

  describe("filters", () => {
    it("filters by inputType", async () => {
      const entries = [
        makeEntry({ id: 1, inputType: "word" }),
        makeEntry({ id: 2, inputType: "phrase" }),
        makeEntry({ id: 3, inputType: "word" }),
      ];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: {
          strategy: "oldest_first",
          limit: 10,
          filter: { inputType: ["phrase"] },
        },
      });

      const result = await pipeline.run(42, config);

      expect(result.words).toHaveLength(1);
      expect(result.words[0]!.id).toBe(2);
    });

    it("filters by excludeIds", async () => {
      const entries = [makeEntry({ id: 1 }), makeEntry({ id: 2 }), makeEntry({ id: 3 })];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: {
          strategy: "oldest_first",
          limit: 10,
          filter: { excludeIds: [1, 3] },
        },
      });

      const result = await pipeline.run(42, config);

      expect(result.words).toHaveLength(1);
      expect(result.words[0]!.id).toBe(2);
    });

    it("filters by targetLang — excludes words missing that lang", async () => {
      const entries = [
        makeEntry({
          id: 1,
          translations: [
            {
              targetLangCode: "cs",
              text: "x",
              expressionType: null,
              equivalentNote: null,
              connotationWarning: null,
              details: null,
            },
          ],
        }),
        makeEntry({
          id: 2,
          translations: [
            {
              targetLangCode: "de",
              text: "y",
              expressionType: null,
              equivalentNote: null,
              connotationWarning: null,
              details: null,
            },
          ],
        }),
        makeEntry({
          id: 3,
          translations: [
            {
              targetLangCode: "cs",
              text: "z",
              expressionType: null,
              equivalentNote: null,
              connotationWarning: null,
              details: null,
            },
            {
              targetLangCode: "de",
              text: "w",
              expressionType: null,
              equivalentNote: null,
              connotationWarning: null,
              details: null,
            },
          ],
        }),
      ];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: {
          strategy: "oldest_first",
          limit: 10,
          filter: { targetLang: "de" },
        },
      });

      const result = await pipeline.run(42, config);

      expect(result.words.map((w) => w.id)).toEqual([2, 3]);
    });

    it("filters by sourceLangId", async () => {
      const entries = [
        makeEntry({ id: 1, sourceLangId: 1 }),
        makeEntry({ id: 2, sourceLangId: 2 }),
        makeEntry({ id: 3, sourceLangId: 1 }),
      ];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: {
          strategy: "oldest_first",
          limit: 10,
          filter: { sourceLangId: 2 },
        },
      });

      const result = await pipeline.run(42, config);

      expect(result.words).toHaveLength(1);
      expect(result.words[0]!.id).toBe(2);
    });

    it("excludeIds excludes all → empty result", async () => {
      const entries = [makeEntry({ id: 1 }), makeEntry({ id: 2 })];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: {
          strategy: "random",
          limit: 10,
          filter: { excludeIds: [1, 2] },
        },
      });

      const result = await pipeline.run(42, config);

      expect(result.words).toHaveLength(0);
      expect(result.meta.totalInDictionary).toBe(2);
    });
  });

  describe("meta", () => {
    it("totalInDictionary reflects full pool size", async () => {
      const entries = Array.from({ length: 15 }, (_, i) => makeEntry({ id: i + 1 }));
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "random", limit: 5 },
      });

      const result = await pipeline.run(42, config);

      expect(result.meta.totalInDictionary).toBe(15);
      expect(result.meta.selectedCount).toBe(5);
    });
  });

  describe("presentation — targetLangs filter", () => {
    it("output only includes requested languages", async () => {
      const entries = [
        makeEntry({
          id: 1,
          translations: [
            {
              targetLangCode: "cs",
              text: "čeština",
              expressionType: null,
              equivalentNote: null,
              connotationWarning: null,
              details: null,
            },
            {
              targetLangCode: "de",
              text: "deutsch",
              expressionType: null,
              equivalentNote: null,
              connotationWarning: null,
              details: null,
            },
            {
              targetLangCode: "fr",
              text: "français",
              expressionType: null,
              equivalentNote: null,
              connotationWarning: null,
              details: null,
            },
          ],
        }),
      ];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "random", limit: 10 },
        presentation: {
          fields: {
            synonyms: true,
            examples: true,
            alternatives: true,
            equivalentNote: true,
            connotationWarning: true,
          },
          targetLangs: ["cs", "de"],
        },
      });

      const result = await pipeline.run(42, config);

      expect(Object.keys(result.words[0]!.translations)).toEqual(["cs", "de"]);
    });

    it("excludes entry when targetLangs filter yields empty translations", async () => {
      const entries = [
        makeEntry({
          id: 1,
          translations: [
            {
              targetLangCode: "cs",
              text: "čeština",
              expressionType: null,
              equivalentNote: null,
              connotationWarning: null,
              details: null,
            },
          ],
        }),
      ];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "random", limit: 10 },
        presentation: {
          fields: {
            synonyms: true,
            examples: true,
            alternatives: true,
            equivalentNote: true,
            connotationWarning: true,
          },
          targetLangs: ["de"], // entry only has "cs"
        },
      });

      const result = await pipeline.run(42, config);

      expect(result.words).toHaveLength(0);
    });
  });

  describe("presentation — field masking", () => {
    it("showSynonyms: false → synonyms absent", async () => {
      const entries = [makeEntry({ id: 1 })];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "random", limit: 10 },
        presentation: {
          fields: {
            synonyms: false,
            examples: true,
            alternatives: true,
            equivalentNote: true,
            connotationWarning: true,
          },
        },
      });

      const result = await pipeline.run(42, config);

      const translation = Object.values(result.words[0]!.translations)[0]!;
      expect(translation.synonyms).toBeUndefined();
    });

    it("showExamples: false → examples absent", async () => {
      const entries = [makeEntry({ id: 1 })];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "random", limit: 10 },
        presentation: {
          fields: {
            synonyms: true,
            examples: false,
            alternatives: true,
            equivalentNote: true,
            connotationWarning: true,
          },
        },
      });

      const result = await pipeline.run(42, config);

      const translation = Object.values(result.words[0]!.translations)[0]!;
      expect(translation.examples).toBeUndefined();
    });

    it("showAlternatives: false → alternatives absent", async () => {
      const entries = [
        makeEntry({
          id: 1,
          translations: [
            {
              targetLangCode: "cs",
              text: "test",
              expressionType: null,
              equivalentNote: null,
              connotationWarning: null,
              details: {
                synonyms: [],
                examples: [],
                alternatives: [{ text: "alt", synonyms: [] }],
              },
            },
          ],
        }),
      ];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);
      const config = makeConfig({
        selection: { strategy: "random", limit: 10 },
        presentation: {
          fields: {
            synonyms: true,
            examples: true,
            alternatives: false,
            equivalentNote: true,
            connotationWarning: true,
          },
        },
      });

      const result = await pipeline.run(42, config);

      const translation = Object.values(result.words[0]!.translations)[0]!;
      expect(translation.alternatives).toBeUndefined();
    });
  });

  describe("display data building", () => {
    it("uses default emoji when entry has none", async () => {
      const entries = [makeEntry({ id: 1, emoji: null })];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);

      const result = await pipeline.run(42, makeConfig());

      expect(result.words[0]!.emoji).toBe("📝");
    });

    it("preserves expressionType from translation row", async () => {
      const entries = [
        makeEntry({
          id: 1,
          translations: [
            {
              targetLangCode: "cs",
              text: "test",
              expressionType: "idiomatic_equivalent",
              equivalentNote: "Idiomatic note",
              connotationWarning: null,
              details: null,
            },
          ],
        }),
      ];
      const deps = makeDeps(entries);
      const pipeline = createDictionaryPipeline(deps);

      const result = await pipeline.run(42, makeConfig());

      const translation = Object.values(result.words[0]!.translations)[0]!;
      expect(translation.expressionType).toBe("idiomatic_equivalent");
      expect(translation.equivalentNote).toBe("Idiomatic note");
    });
  });
});

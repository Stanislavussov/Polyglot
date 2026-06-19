/**
 * Tests for the Context Enrichment Service.
 *
 * All dependencies (lookupContext, generateObjectFn) are mocked.
 * No real DB or AI calls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DictionaryContext, LanguageTranslation, TranslateOutput } from "../../translation/types.js";
import type { ContextEnrichmentDeps, DictionaryContextCandidate, EnrichedTranslateInput } from "../types.js";

// Mock the translation service
vi.mock("../../translation/translation.service.js", () => ({
  translate: vi.fn(),
  translateOne: vi.fn(),
}));

import { translate, translateOne } from "../../translation/translation.service.js";
import {
  translateBatchWithContext,
  translateOneWithContext,
  translateWithContext,
} from "../context-enrichment.service.js";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeDictionaryContext(word: string, langCode: string = "en"): DictionaryContext {
  return {
    word,
    pos: "noun",
    glosses: [`A definition of ${word}`],
    formTags: ["canonical"],
    langCode,
  };
}

function makeTranslateOutput(
  original: string,
  targetLangs: string[],
  dictionaryContext?: DictionaryContext,
): TranslateOutput {
  const translations: Record<string, LanguageTranslation> = {};
  for (const lang of targetLangs) {
    translations[lang] = {
      text: `${original}_${lang}`,
      synonyms: [],
      examples: [],
    };
  }
  return {
    original,
    sourceLang: "en",
    emoji: "📝",
    nativeSynonyms: [],
    translations,
    ...(dictionaryContext ? { dictionaryContext } : {}),
  };
}

function makeLangTranslation(word: string, lang: string): LanguageTranslation {
  return {
    text: `${word}_${lang}`,
    synonyms: [],
    examples: [],
  };
}

function createMockDeps(lookupResult?: DictionaryContext | undefined, lookupError?: Error): ContextEnrichmentDeps {
  const candidates: DictionaryContextCandidate[] = lookupResult ? [{ matchType: "lemma", context: lookupResult }] : [];
  const lookupContext = lookupError ? vi.fn().mockRejectedValue(lookupError) : vi.fn().mockResolvedValue(candidates);

  return {
    lookupContext,
    generateObjectFn: vi.fn(),
  };
}

const baseInput: EnrichedTranslateInput = {
  word: "apple",
  sourceLang: "en",
  targetLangs: ["cs", "de"],
  model: "test-model",
};

// ─────────────────────────────────────────────
// translateWithContext
// ─────────────────────────────────────────────

describe("translateWithContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls lookupContext with word and sourceLang", async () => {
    const deps = createMockDeps(undefined);
    vi.mocked(translate).mockResolvedValue(makeTranslateOutput("apple", ["cs", "de"]));

    await translateWithContext(baseInput, deps);

    expect(deps.lookupContext).toHaveBeenCalledWith("apple", "en");
    expect(deps.lookupContext).toHaveBeenCalledTimes(1);
  });

  it("merges dictionary context into translate input when found", async () => {
    const ctx = makeDictionaryContext("apple");
    const deps = createMockDeps(ctx);
    vi.mocked(translate).mockResolvedValue(makeTranslateOutput("apple", ["cs", "de"], ctx));

    await translateWithContext(baseInput, deps);

    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "apple",
        sourceLang: "en",
        targetLangs: ["cs", "de"],
        model: "test-model",
        dictionaryContext: ctx,
      }),
      deps.generateObjectFn,
    );
  });

  it("does not select an ambiguous dictionary sense before ranking", async () => {
    const first = makeDictionaryContext("bank");
    const second = { ...makeDictionaryContext("bank"), glosses: ["river edge"] };
    const deps: ContextEnrichmentDeps = {
      lookupContext: vi.fn().mockResolvedValue([
        { matchType: "lemma", context: first },
        { matchType: "lemma", context: second },
      ]),
      generateObjectFn: vi.fn(),
    };
    vi.mocked(translate).mockResolvedValue(makeTranslateOutput("bank", ["cs", "de"]));

    await translateWithContext({ ...baseInput, word: "bank" }, deps);

    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "bank",
        dictionaryContext: undefined,
      }),
      deps.generateObjectFn,
    );
  });

  it("calls translate without dictionaryContext when lookup returns undefined", async () => {
    const deps = createMockDeps(undefined);
    vi.mocked(translate).mockResolvedValue(makeTranslateOutput("apple", ["cs", "de"]));

    await translateWithContext(baseInput, deps);

    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "apple",
        dictionaryContext: undefined,
      }),
      deps.generateObjectFn,
    );
  });

  it("calls translate without dictionaryContext when lookup throws (fail-open)", async () => {
    const deps = createMockDeps(undefined, new Error("DB connection failed"));
    vi.mocked(translate).mockResolvedValue(makeTranslateOutput("apple", ["cs", "de"]));

    await translateWithContext(baseInput, deps);

    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "apple",
        dictionaryContext: undefined,
      }),
      deps.generateObjectFn,
    );
  });

  it("returns TranslateOutput from translate() as-is", async () => {
    const expected = makeTranslateOutput("apple", ["cs", "de"]);
    const deps = createMockDeps(undefined);
    vi.mocked(translate).mockResolvedValue(expected);

    const result = await translateWithContext(baseInput, deps);

    expect(result).toBe(expected);
  });

  it("passes generateObjectFn to translate()", async () => {
    const deps = createMockDeps(undefined);
    vi.mocked(translate).mockResolvedValue(makeTranslateOutput("apple", ["cs", "de"]));

    await translateWithContext(baseInput, deps);

    expect(translate).toHaveBeenCalledWith(expect.anything(), deps.generateObjectFn);
  });

  it("preserves all input fields (topic, userId) in translate call", async () => {
    const inputWithExtras: EnrichedTranslateInput = {
      ...baseInput,
      topic: "food",
      userId: 42,
    };
    const deps = createMockDeps(undefined);
    vi.mocked(translate).mockResolvedValue(makeTranslateOutput("apple", ["cs", "de"]));

    await translateWithContext(inputWithExtras, deps);

    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "apple",
        topic: "food",
        userId: 42,
      }),
      deps.generateObjectFn,
    );
  });

  it("does not swallow errors from translate()", async () => {
    const deps = createMockDeps(undefined);
    vi.mocked(translate).mockRejectedValue(new Error("AI generation failed"));

    await expect(translateWithContext(baseInput, deps)).rejects.toThrow("AI generation failed");
  });
});

// ─────────────────────────────────────────────
// translateOneWithContext
// ─────────────────────────────────────────────

describe("translateOneWithContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const oneInput = { ...baseInput, targetLang: "cs" };

  it("calls lookupContext with word and sourceLang", async () => {
    const deps = createMockDeps(undefined);
    vi.mocked(translateOne).mockResolvedValue(makeLangTranslation("apple", "cs"));

    await translateOneWithContext(oneInput, deps);

    expect(deps.lookupContext).toHaveBeenCalledWith("apple", "en");
  });

  it("passes dictionaryContext to translateOne when found", async () => {
    const ctx = makeDictionaryContext("apple");
    const deps = createMockDeps(ctx);
    vi.mocked(translateOne).mockResolvedValue(makeLangTranslation("apple", "cs"));

    await translateOneWithContext(oneInput, deps);

    expect(translateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "apple",
        targetLang: "cs",
        dictionaryContext: ctx,
      }),
      deps.generateObjectFn,
    );
  });

  it("calls translateOne without dictionaryContext when lookup returns undefined", async () => {
    const deps = createMockDeps(undefined);
    vi.mocked(translateOne).mockResolvedValue(makeLangTranslation("apple", "cs"));

    await translateOneWithContext(oneInput, deps);

    expect(translateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        dictionaryContext: undefined,
      }),
      deps.generateObjectFn,
    );
  });

  it("handles lookup errors gracefully (fail-open)", async () => {
    const deps = createMockDeps(undefined, new Error("DB error"));
    vi.mocked(translateOne).mockResolvedValue(makeLangTranslation("apple", "cs"));

    await translateOneWithContext(oneInput, deps);

    expect(translateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        dictionaryContext: undefined,
      }),
      deps.generateObjectFn,
    );
  });

  it("returns LanguageTranslation from translateOne() as-is", async () => {
    const expected = makeLangTranslation("apple", "cs");
    const deps = createMockDeps(undefined);
    vi.mocked(translateOne).mockResolvedValue(expected);

    const result = await translateOneWithContext(oneInput, deps);

    expect(result).toBe(expected);
  });
});

// ─────────────────────────────────────────────
// translateBatchWithContext
// ─────────────────────────────────────────────

describe("translateBatchWithContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls lookupContext for each word in the batch", async () => {
    const deps = createMockDeps(undefined);
    vi.mocked(translate).mockImplementation(async (input) => makeTranslateOutput(input.word, input.targetLangs));

    await translateBatchWithContext(["apple", "banana", "cherry"], "en", ["cs"], "test-model", deps);

    expect(deps.lookupContext).toHaveBeenCalledTimes(3);
    expect(deps.lookupContext).toHaveBeenCalledWith("apple", "en");
    expect(deps.lookupContext).toHaveBeenCalledWith("banana", "en");
    expect(deps.lookupContext).toHaveBeenCalledWith("cherry", "en");
  });

  it("processes words sequentially (not in parallel)", async () => {
    const callOrder: string[] = [];
    const deps = createMockDeps(undefined);
    vi.mocked(translate).mockImplementation(async (input) => {
      callOrder.push(input.word);
      return makeTranslateOutput(input.word, input.targetLangs);
    });

    await translateBatchWithContext(["first", "second", "third"], "en", ["cs"], "test-model", deps);

    expect(callOrder).toEqual(["first", "second", "third"]);
  });

  it("returns TranslateOutput for each word", async () => {
    const deps = createMockDeps(undefined);
    vi.mocked(translate).mockImplementation(async (input) => makeTranslateOutput(input.word, input.targetLangs));

    const results = await translateBatchWithContext(["apple", "banana"], "en", ["cs", "de"], "test-model", deps);

    expect(results).toHaveLength(2);
    expect(results[0]!.original).toBe("apple");
    expect(results[1]!.original).toBe("banana");
  });

  it("enriches each word with its own dictionary context", async () => {
    const appleCtx = makeDictionaryContext("apple");
    const deps: ContextEnrichmentDeps = {
      lookupContext: vi
        .fn()
        .mockImplementation((word: string) =>
          Promise.resolve(word === "apple" ? [{ matchType: "lemma", context: appleCtx }] : []),
        ),
      generateObjectFn: vi.fn(),
    };
    vi.mocked(translate).mockImplementation(async (input) =>
      makeTranslateOutput(input.word, input.targetLangs, input.dictionaryContext),
    );

    await translateBatchWithContext(["apple", "banana"], "en", ["cs"], "test-model", deps);

    // First call should have apple's context
    expect(vi.mocked(translate).mock.calls[0]![0]).toMatchObject({
      word: "apple",
      dictionaryContext: appleCtx,
    });

    // Second call should have no context
    expect(vi.mocked(translate).mock.calls[1]![0]).toMatchObject({
      word: "banana",
      dictionaryContext: undefined,
    });
  });

  it("returns empty array for empty word list", async () => {
    const deps = createMockDeps(undefined);

    const results = await translateBatchWithContext([], "en", ["cs"], "test-model", deps);

    expect(results).toEqual([]);
    expect(deps.lookupContext).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
  });

  it("continues batch when one lookup fails (fail-open)", async () => {
    let callCount = 0;
    const deps: ContextEnrichmentDeps = {
      lookupContext: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) return Promise.reject(new Error("DB error"));
        return Promise.resolve(undefined);
      }),
      generateObjectFn: vi.fn(),
    };
    vi.mocked(translate).mockImplementation(async (input) => makeTranslateOutput(input.word, input.targetLangs));

    const results = await translateBatchWithContext(["apple", "banana", "cherry"], "en", ["cs"], "test-model", deps);

    // All 3 words should still be translated
    expect(results).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────
// General / edge cases
// ─────────────────────────────────────────────

describe("context enrichment — general", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses sourceLang for dictionary lookup, not targetLang", async () => {
    const deps = createMockDeps(undefined);
    vi.mocked(translate).mockResolvedValue(makeTranslateOutput("привет", ["cs"]));

    await translateWithContext({ word: "привет", sourceLang: "ru", targetLangs: ["cs"], model: "m" }, deps);

    expect(deps.lookupContext).toHaveBeenCalledWith("привет", "ru");
  });

  it("all deps are injected — no real DB or AI calls", () => {
    // This is a structural test — verifying the interface
    const deps: ContextEnrichmentDeps = {
      lookupContext: vi.fn(),
      generateObjectFn: vi.fn(),
    };

    // Both deps should be mock functions
    expect(vi.isMockFunction(deps.lookupContext)).toBe(true);
    expect(vi.isMockFunction(deps.generateObjectFn)).toBe(true);
  });
});

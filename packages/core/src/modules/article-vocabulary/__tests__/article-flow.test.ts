/**
 * Spec — an article run turns the stored, cleaned body into phrases:
 *
 * 1. The prompt carries the title, the body, the learner's level and native language,
 *    and lists what they already know; the output budget scales with the target.
 * 2. Known phrases, duplicates and anything past the target are dropped; the rest are
 *    stored in rank order and the run completes.
 * 3. When the text turns out to be in another (known) language than the page declared,
 *    the run takes the language the model reports.
 * 4. An AI failure marks the run failed and is returned, never thrown.
 * 5. The phrase target grows with length and stays inside the admin range.
 */
import { describe, expect, it, vi } from "vitest";
import type { ArticleProcess, ArticleVocabularyRepository } from "../../../ports/article-vocabulary.repository.js";
import { type ArticleFlowDeps, processArticle } from "../article-flow.js";
import { computeArticlePhraseTarget } from "../target.js";

const PROCESS: ArticleProcess = {
  id: 7,
  userId: 3,
  url: "https://example.com/forests",
  title: "Tiny forests",
  siteName: "Daily Planet",
  language: "en",
  content: "Cities are planting tiny forests.\n\nThey cool the streets.",
  wordCount: 800,
  truncated: false,
  status: "pending",
  errorMessage: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function phrase(text: string) {
  return {
    phrase: text,
    nativeTranslation: `${text}-ru`,
    emoji: "🌳",
    type: "phrase",
    level: "B2",
    context: `a ${text}`,
  };
}

function arrange(aiResult: unknown, overrides: Partial<ArticleVocabularyRepository> = {}) {
  const repo = {
    findProcessById: vi.fn().mockResolvedValue(PROCESS),
    updateProcessStatus: vi.fn().mockResolvedValue(undefined),
    updateProcessLanguage: vi.fn().mockResolvedValue(undefined),
    findKnownPhrasesByUser: vi.fn().mockResolvedValue(["Known one"]),
    savePhrases: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const generateObject = vi.fn(async () => {
    if (aiResult instanceof Error) throw aiResult;
    return aiResult;
  });
  const deps = {
    articleVocabularyRepository: repo,
    userRepository: {
      getLanguageLevels: vi.fn().mockResolvedValue([{ languageCode: "en", proficiencyLevel: "B2" }]),
      getSettings: vi.fn().mockResolvedValue({ nativeLang: "ru" }),
    },
    settings: {
      getVideoVocabularyConfig: vi
        .fn()
        .mockResolvedValue({ monthlyLimit: 5, minPhrases: 1, maxPhrases: 3, extractionModelId: "test/extract" }),
    },
    languageCache: {
      getLang: vi.fn().mockReturnValue({ id: 1 }),
      getLangName: (code: string) => ({ en: "English", ru: "Russian", de: "German" })[code] ?? code,
      normalizeToIso1: (code: string) => code,
      isKnownLang: (code: string) => ["en", "ru", "de"].includes(code),
    },
    vocabularyRepository: { findOriginalsByUserAndSource: vi.fn().mockResolvedValue(["saved word"]) },
    ai: { generateObject },
  } as unknown as ArticleFlowDeps;
  return { deps, repo, generateObject };
}

describe("processArticle", () => {
  it("builds a lean prompt and stores fresh phrases in rank order", async () => {
    const { deps, repo, generateObject } = arrange({
      language: "en",
      phrases: [
        phrase("known one"),
        phrase("tiny forest"),
        phrase("Tiny forest"),
        phrase("cool down"),
        phrase("saved word"),
        phrase("a third"),
        phrase("over target"),
      ],
    });

    const outcome = await processArticle(deps, PROCESS.id);

    expect(outcome).toEqual({ status: "completed", phraseCount: 3 });
    const [prompt, , model, options] = generateObject.mock.calls[0] as unknown as [
      string,
      unknown,
      string,
      { maxTokens: number },
    ];
    expect(prompt).toContain("## Tiny forests");
    expect(prompt).toContain("They cool the streets.");
    expect(prompt).toContain("B2 learner whose native language is Russian");
    expect(prompt).toContain("saved word, Known one");
    expect(model).toBe("test/extract");
    expect(options.maxTokens).toBeGreaterThanOrEqual(2048);
    expect(repo.savePhrases).toHaveBeenCalledWith(PROCESS.id, [
      expect.objectContaining({ phrase: "tiny forest", sortOrder: 1 }),
      expect.objectContaining({ phrase: "cool down", sortOrder: 2 }),
      expect.objectContaining({ phrase: "a third", sortOrder: 3 }),
    ]);
    expect(repo.updateProcessStatus).toHaveBeenLastCalledWith(PROCESS.id, "completed");
    expect(repo.updateProcessLanguage).not.toHaveBeenCalled();
  });

  it("takes the language the text is really in", async () => {
    const { deps, repo } = arrange({ language: "DE", phrases: [phrase("der Wald")] });

    await processArticle(deps, PROCESS.id);

    expect(repo.updateProcessLanguage).toHaveBeenCalledWith(PROCESS.id, "de");
  });

  it("marks the run failed when the model fails", async () => {
    const { deps, repo } = arrange(new Error("provider down"));

    expect(await processArticle(deps, PROCESS.id)).toEqual({ status: "failed", error: "provider down" });
    expect(repo.updateProcessStatus).toHaveBeenLastCalledWith(PROCESS.id, "failed", "provider down");
    expect(repo.savePhrases).not.toHaveBeenCalled();
  });
});

describe("computeArticlePhraseTarget", () => {
  it("grows with length inside the admin range", () => {
    expect(computeArticlePhraseTarget(800, 5, 40)).toBe(15);
    expect(computeArticlePhraseTarget(1600, 5, 40)).toBe(21);
    expect(computeArticlePhraseTarget(100, 5, 40)).toBe(5);
    expect(computeArticlePhraseTarget(100_000, 5, 40)).toBe(40);
    expect(computeArticlePhraseTarget(0, 5, 40)).toBe(15);
  });
});

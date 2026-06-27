import { describe, expect, it, vi } from "vitest";
import { type GrammarDetailInput, generateGrammarDetail } from "../grammar-detail.service.js";

describe("generateGrammarDetail", () => {
  const baseInput: GrammarDetailInput = {
    originalText: "auf den Tisch",
    translation: "na stůl",
    langCode: "cs",
    nativeLang: "ru",
    grammarBreakdown: ["na + Akuzativ — направление движения"],
  };

  it("calls generateTextFn with prompt and model", async () => {
    const generateTextFn = vi.fn().mockResolvedValue("Detailed explanation...");

    const result = await generateGrammarDetail(baseInput, generateTextFn, "test-model");

    expect(generateTextFn).toHaveBeenCalledOnce();
    expect(result).toBe("Detailed explanation...");
  });

  it("includes original text and translation in the prompt", async () => {
    const generateTextFn = vi.fn().mockResolvedValue("text");

    await generateGrammarDetail(baseInput, generateTextFn, "test-model");

    const prompt = generateTextFn.mock.calls[0][0] as string;
    expect(prompt).toContain("auf den Tisch");
    expect(prompt).toContain("na stůl");
  });

  it("includes existing grammar breakdown items in the prompt", async () => {
    const generateTextFn = vi.fn().mockResolvedValue("text");

    await generateGrammarDetail(baseInput, generateTextFn, "test-model");

    const prompt = generateTextFn.mock.calls[0][0] as string;
    expect(prompt).toContain("na + Akuzativ");
  });

  it("includes native language name for explanations", async () => {
    const generateTextFn = vi.fn().mockResolvedValue("text");

    await generateGrammarDetail(baseInput, generateTextFn, "test-model");

    const prompt = generateTextFn.mock.calls[0][0] as string;
    expect(prompt).toContain("Russian");
  });

  it("includes target language name", async () => {
    const generateTextFn = vi.fn().mockResolvedValue("text");

    await generateGrammarDetail(baseInput, generateTextFn, "test-model");

    const prompt = generateTextFn.mock.calls[0][0] as string;
    expect(prompt).toContain("Czech");
  });

  it("passes userId to generateTextFn", async () => {
    const generateTextFn = vi.fn().mockResolvedValue("text");

    await generateGrammarDetail(baseInput, generateTextFn, "test-model", 42);

    expect(generateTextFn.mock.calls[0][2]).toEqual({ userId: 42 });
  });

  it("requests plain text without HTML or markdown", async () => {
    const generateTextFn = vi.fn().mockResolvedValue("text");

    await generateGrammarDetail(baseInput, generateTextFn, "test-model");

    const prompt = generateTextFn.mock.calls[0][0] as string;
    expect(prompt).toContain("plain text only");
  });
});

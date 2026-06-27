import { describe, expect, it, vi } from "vitest";
import { type GrammarBreakdownInput, generateGrammarBreakdown } from "../grammar-breakdown.service.js";

describe("generateGrammarBreakdown", () => {
  const baseInput: GrammarBreakdownInput = {
    originalText: "Er hätte es mir gesagt",
    translations: {
      cs: "Řekl by mi to",
      es: "Me lo habría dicho",
    },
    sourceLang: "de",
    targetLangs: ["cs", "es"],
    nativeLang: "ru",
    inputType: "sentence",
  };

  it("calls generateObjectFn with prompt and schema", async () => {
    const mockResult = {
      grammarBreakdown: {
        cs: ["by + minulé příčestí — подмет II, нереальное условие"],
        es: ["Condicional compuesto — условное прошедшее"],
      },
    };
    const generateObjectFn = vi.fn().mockResolvedValue(mockResult);

    const result = await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model");

    expect(generateObjectFn).toHaveBeenCalledOnce();
    expect(result).toEqual(mockResult.grammarBreakdown);
  });

  it("includes original text and translations in the prompt", async () => {
    const mockResult = {
      grammarBreakdown: {
        cs: ["pattern 1"],
      },
    };
    const generateObjectFn = vi.fn().mockResolvedValue(mockResult);

    await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model");

    const prompt = generateObjectFn.mock.calls[0][0] as string;
    expect(prompt).toContain("Er hätte es mir gesagt");
    expect(prompt).toContain("Řekl by mi to");
    expect(prompt).toContain("Me lo habría dicho");
  });

  it("includes native language name for explanations", async () => {
    const mockResult = { grammarBreakdown: { cs: ["x"] } };
    const generateObjectFn = vi.fn().mockResolvedValue(mockResult);

    await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model");

    const prompt = generateObjectFn.mock.calls[0][0] as string;
    expect(prompt).toContain("Russian");
  });

  it("specifies 4-5 items for sentences", async () => {
    const mockResult = { grammarBreakdown: { cs: ["x"] } };
    const generateObjectFn = vi.fn().mockResolvedValue(mockResult);

    await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model");

    const prompt = generateObjectFn.mock.calls[0][0] as string;
    expect(prompt).toContain("4-5");
  });

  it("specifies 2-3 items for phrases", async () => {
    const mockResult = { grammarBreakdown: { cs: ["x"] } };
    const generateObjectFn = vi.fn().mockResolvedValue(mockResult);

    await generateGrammarBreakdown({ ...baseInput, inputType: "phrase" }, generateObjectFn, "test-model");

    const prompt = generateObjectFn.mock.calls[0][0] as string;
    expect(prompt).toContain("2-3");
  });

  it("passes userId to generateObjectFn", async () => {
    const mockResult = { grammarBreakdown: { cs: ["x"] } };
    const generateObjectFn = vi.fn().mockResolvedValue(mockResult);

    await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model", 42);

    expect(generateObjectFn.mock.calls[0][3]).toEqual({ userId: 42 });
  });
});

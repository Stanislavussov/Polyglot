import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { type GrammarBreakdownInput, generateGrammarBreakdown } from "../grammar-breakdown.service.js";

/** One `{ lang, items }` entry as the model is asked to return it. */
function langEntry(lang: string, ...items: string[]) {
  return { lang, items };
}

function answering(...languages: ReturnType<typeof langEntry>[]) {
  return vi.fn().mockResolvedValue({ languages });
}

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

  it("maps the model's per-language list onto the card's langCode → items record", async () => {
    const generateObjectFn = answering(
      langEntry("cs", "by + minulé příčestí — подмет II, нереальное условие"),
      langEntry("es", "Condicional compuesto — условное прошедшее"),
    );

    const result = await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model");

    expect(generateObjectFn).toHaveBeenCalledOnce();
    expect(result).toEqual({
      cs: ["by + minulé příčestí — подмет II, нереальное условие"],
      es: ["Condicional compuesto — условное прошедшее"],
    });
  });

  it("asks for a schema with named keys, never a dynamic-key map", async () => {
    // The regression this file exists for: `z.record(langCode, items)` compiles to
    // `additionalProperties`, which strict structured outputs reject outright — the
    // provider refused the request and the Grammar button failed on every card.
    const generateObjectFn = answering(langEntry("cs", "x"));

    await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model");

    const schema = generateObjectFn.mock.calls[0]![1] as z.ZodType;
    const parsed = schema.safeParse({ languages: [{ lang: "cs", items: ["x"] }] });
    expect(parsed.success).toBe(true);
    expect(schema.safeParse({ grammarBreakdown: { cs: ["x"] } }).success).toBe(false);
  });

  it("accepts the uppercased codes its own prompt prints", async () => {
    // The prompt lists the languages as "CS (Czech)", so a model echoing "CS" is
    // following instructions; a card that dropped it would look like a dead button.
    const generateObjectFn = answering(langEntry("CS", "x"), langEntry("ES", "y"));

    const result = await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model");

    expect(result).toEqual({ cs: ["x"], es: ["y"] });
  });

  it("drops a language nobody asked about and one that came back empty", async () => {
    const generateObjectFn = answering(
      langEntry("cs", "kept"),
      langEntry("fr", "never requested"),
      langEntry("es", "   "),
    );

    const result = await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model");

    expect(result).toEqual({ cs: ["kept"] });
  });

  it("caps a talkative answer at five items per language", async () => {
    // `maxItems` is one of the keywords strict structured outputs reject, so the
    // ceiling cannot live in the schema and has to hold here.
    const generateObjectFn = answering(langEntry("cs", "1", "2", "3", "4", "5", "6", "7"));

    const result = await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model");

    expect(result.cs).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("includes original text and translations in the prompt", async () => {
    const generateObjectFn = answering(langEntry("cs", "pattern 1"));

    await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model");

    const prompt = generateObjectFn.mock.calls[0]![0] as string;
    expect(prompt).toContain("Er hätte es mir gesagt");
    expect(prompt).toContain("Řekl by mi to");
    expect(prompt).toContain("Me lo habría dicho");
  });

  it("includes native language name for explanations", async () => {
    const generateObjectFn = answering(langEntry("cs", "x"));

    await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model");

    expect(generateObjectFn.mock.calls[0]![0] as string).toContain("Russian");
  });

  it("specifies 4-5 items for sentences", async () => {
    const generateObjectFn = answering(langEntry("cs", "x"));

    await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model");

    expect(generateObjectFn.mock.calls[0]![0] as string).toContain("4-5");
  });

  it("specifies 2-3 items for phrases", async () => {
    const generateObjectFn = answering(langEntry("cs", "x"));

    await generateGrammarBreakdown({ ...baseInput, inputType: "phrase" }, generateObjectFn, "test-model");

    expect(generateObjectFn.mock.calls[0]![0] as string).toContain("2-3");
  });

  it("passes userId to generateObjectFn", async () => {
    const generateObjectFn = answering(langEntry("cs", "x"));

    await generateGrammarBreakdown(baseInput, generateObjectFn, "test-model", 42);

    expect(generateObjectFn.mock.calls[0]![3]).toEqual({ userId: 42 });
  });
});

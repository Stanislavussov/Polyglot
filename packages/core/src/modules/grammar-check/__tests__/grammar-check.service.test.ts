import { describe, expect, it, vi } from "vitest";
import { buildGrammarCheckPrompt } from "../grammar-check.prompt.js";
import type { GrammarCheckAiResult } from "../grammar-check.schema.js";
import { checkGrammar, type GrammarCheckInput } from "../grammar-check.service.js";

const input: GrammarCheckInput = {
  text: "Ich habe gestern nach Berlin gefahren.",
  nativeLang: "ru",
  learningLangs: ["de", "cs"],
  levels: { de: "A2" },
  interfaceLang: "en",
};

const issue = {
  fragment: "habe gefahren",
  correction: "bin gefahren",
  category: "tense" as const,
  explanation: "Verbs of movement take sein in the Perfekt.",
  example: "Ich bin nach Hause gegangen.",
};

function aiReturning(result: Partial<GrammarCheckAiResult>) {
  return vi.fn().mockResolvedValue({
    detectedLanguage: "de",
    errors: [],
    correctedText: input.text,
    naturalAlternative: null,
    ...result,
  });
}

describe("buildGrammarCheckPrompt", () => {
  it("offers only the learner's own languages, with their CEFR level where one was chosen", () => {
    const prompt = buildGrammarCheckPrompt(input);

    expect(prompt).toContain("de (German) — learning, CEFR A2");
    expect(prompt).toContain("cs (Czech) — learning");
    expect(prompt).not.toMatch(/cs \(Czech\) — learning, CEFR/);
    expect(prompt).toContain("ru (Russian) — native");
    expect(prompt).not.toContain("French");
  });

  it("asks for explanations in the interface language and carries the text verbatim", () => {
    const prompt = buildGrammarCheckPrompt({ ...input, interfaceLang: "uk" });

    expect(prompt).toContain("1-2 sentences in Ukrainian");
    expect(prompt).toContain(input.text);
  });

  it("covers every area of the grammar basics the check promises", () => {
    const prompt = buildGrammarCheckPrompt(input);

    for (const area of [
      "vocabulary",
      "prepositions",
      "articles",
      "word order",
      "agreement",
      "tense",
      "spelling",
      "punctuation",
    ]) {
      expect(prompt).toContain(area);
    }
  });
});

describe("checkGrammar", () => {
  it("returns each mistake with the corrected text for a text in a learning language", async () => {
    const ai = aiReturning({ errors: [issue], correctedText: "Ich bin gestern nach Berlin gefahren." });

    const outcome = await checkGrammar(input, ai, "test-model");

    expect(outcome).toEqual({
      status: "checked",
      language: "de",
      errors: [issue],
      correctedText: "Ich bin gestern nach Berlin gefahren.",
      naturalAlternative: null,
    });
  });

  it("checks a text written in the native language too", async () => {
    const ai = aiReturning({ detectedLanguage: "ru", correctedText: "Привет" });

    const outcome = await checkGrammar({ ...input, text: "Привет" }, ai, "test-model");

    expect(outcome.status).toBe("checked");
  });

  it("refuses a text in a language outside the learner's set, naming what was detected", async () => {
    const ai = aiReturning({ detectedLanguage: "fr" });

    const outcome = await checkGrammar({ ...input, text: "Je suis allé" }, ai, "test-model");

    expect(outcome).toEqual({ status: "unsupported_language", detectedLanguage: "fr" });
  });

  it("accepts a detected language reported as a name or in upper case", async () => {
    expect((await checkGrammar(input, aiReturning({ detectedLanguage: "German" }), "m")).status).toBe("checked");
    expect((await checkGrammar(input, aiReturning({ detectedLanguage: "DE" }), "m")).status).toBe("checked");
  });

  it("offers a more natural phrasing only for a correct text, and never one identical to the input", async () => {
    const withErrors = await checkGrammar(
      input,
      aiReturning({ errors: [issue], naturalAlternative: "Gestern bin ich nach Berlin gefahren." }),
      "m",
    );
    const echoed = await checkGrammar(input, aiReturning({ naturalAlternative: ` ${input.text} ` }), "m");
    const offered = await checkGrammar(
      input,
      aiReturning({ naturalAlternative: "Gestern bin ich nach Berlin gefahren." }),
      "m",
    );

    expect(withErrors.status === "checked" && withErrors.naturalAlternative).toBeNull();
    expect(echoed.status === "checked" && echoed.naturalAlternative).toBeNull();
    expect(offered.status === "checked" && offered.naturalAlternative).toBe("Gestern bin ich nach Berlin gefahren.");
  });

  it("falls back to the learner's text when the model leaves the corrected text empty", async () => {
    const outcome = await checkGrammar(input, aiReturning({ correctedText: "  " }), "m");

    expect(outcome.status === "checked" && outcome.correctedText).toBe(input.text);
  });

  it("passes the model and call options through to the AI", async () => {
    const ai = aiReturning({});
    const options = { userId: 7, budgetMs: 1000 };

    await checkGrammar(input, ai, "test-model", options);

    expect(ai.mock.calls[0][2]).toBe("test-model");
    expect(ai.mock.calls[0][3]).toBe(options);
  });
});

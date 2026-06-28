import { describe, expect, it } from "vitest";
import { buildExtractionPrompt } from "../extraction.prompt.js";

describe("buildExtractionPrompt", () => {
  it("includes transcript, language, level, max phrases, and native language", () => {
    const prompt = buildExtractionPrompt("Hello world transcript", "English", "B2", 30, "Russian");

    expect(prompt).toContain("Hello world transcript");
    expect(prompt).toContain("English");
    expect(prompt).toContain("B2");
    expect(prompt).toContain("30");
    expect(prompt).toContain("Russian");
  });

  it("instructs to extract up to maxPhrases", () => {
    const prompt = buildExtractionPrompt("Some text", "Spanish", "A2", 15, "English");
    expect(prompt).toContain("up to 15 phrases");
  });

  it("mentions CEFR level filtering", () => {
    const prompt = buildExtractionPrompt("Some text", "German", "C1", 20, "English");
    expect(prompt).toContain("C1-level learner");
    expect(prompt).toContain("C1 learner would already know");
  });

  it("asks for idioms, phrasal verbs, and collocations", () => {
    const prompt = buildExtractionPrompt("Some text", "English", "B1", 30, "Russian");
    expect(prompt).toContain("Idiomatic expressions");
    expect(prompt).toContain("Phrasal verbs");
    expect(prompt).toContain("collocations");
  });

  it("includes native language translation instruction", () => {
    const prompt = buildExtractionPrompt("Some text", "English", "B2", 30, "Russian");
    expect(prompt).toContain("translation");
    expect(prompt).toContain("Russian");
  });
});

import { describe, expect, it } from "vitest";
import { buildExtractionPrompt } from "../extraction.prompt.js";

describe("buildExtractionPrompt", () => {
  it("includes transcript, language, level, target phrases, and native language", () => {
    const prompt = buildExtractionPrompt("Hello world transcript", "English", "B2", 30, "Russian");

    expect(prompt).toContain("Hello world transcript");
    expect(prompt).toContain("English");
    expect(prompt).toContain("B2");
    expect(prompt).toContain("30");
    expect(prompt).toContain("Russian");
  });

  it("instructs to extract the full target count, not a soft maximum", () => {
    const prompt = buildExtractionPrompt("Some text", "Spanish", "A2", 15, "English");
    expect(prompt).toContain("Extract 15 phrases");
    expect(prompt).toContain("Aim for the full target of 15");
    // Must not contain the old conservative "quality over quantity" escape hatch.
    expect(prompt).not.toContain("Quality over quantity");
  });

  it("tailors selection to the CEFR level", () => {
    const prompt = buildExtractionPrompt("Some text", "German", "C1", 20, "English");
    expect(prompt).toContain("C1-level learner");
    expect(prompt).toContain("CEFR level C1");
    expect(prompt).toContain("at or slightly above C1");
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

  it("omits the 'already known' section when no known phrases are provided", () => {
    const prompt = buildExtractionPrompt("Some text", "English", "B2", 30, "Russian", []);
    expect(prompt).not.toContain("Already Known");
  });

  it("lists known phrases and de-duplicates them case-insensitively", () => {
    const prompt = buildExtractionPrompt("Some text", "English", "B2", 30, "Russian", [
      "break it down",
      "Break It Down",
      "serendipity",
    ]);
    expect(prompt).toContain("Already Known — DO NOT extract these");
    expect(prompt).toContain("break it down");
    expect(prompt).toContain("serendipity");
    // De-duplicated: the two casings of "break it down" collapse to one → 2 items.
    expect(prompt).toContain("already has the following 2 items");
  });
});

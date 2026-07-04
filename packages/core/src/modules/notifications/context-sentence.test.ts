import { describe, expect, it } from "vitest";
import { initLanguageRegistry } from "../i18n/language-registry.js";
import { buildContextSentencePrompt } from "./context-sentence.js";

describe("buildContextSentencePrompt", () => {
  it("references human-readable language names, not raw codes, when the registry is populated", () => {
    initLanguageRegistry([
      { code: "ru", name: "Russian", isSupported: true },
      { code: "en", name: "English", isSupported: true },
    ]);

    const prompt = buildContextSentencePrompt("ordering coffee", ["ru", "en"]);

    // Instructions must name the languages ("in Russian"), never "in ru".
    expect(prompt).toContain("Write the sentence in Russian");
    expect(prompt).toContain("Russian (ru)");
    expect(prompt).toContain("English (en)");
    expect(prompt).not.toMatch(/write the sentence in ru\b/i);
  });

  it("keeps the requested JSON keyed by ISO code", () => {
    initLanguageRegistry([{ code: "ru", name: "Russian", isSupported: true }]);

    const prompt = buildContextSentencePrompt("weather", ["ru"]);

    expect(prompt).toContain('"ru":');
    expect(prompt).toContain("keyed by ISO language code");
  });

  it("includes the user's context verbatim", () => {
    initLanguageRegistry([{ code: "en", name: "English", isSupported: true }]);

    const prompt = buildContextSentencePrompt("planning a trip", ["en"]);

    expect(prompt).toContain("planning a trip");
  });
});

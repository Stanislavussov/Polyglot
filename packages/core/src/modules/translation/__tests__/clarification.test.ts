import { describe, expect, it } from "vitest";
import { buildClarificationView, clarifiedTargetLangs } from "../clarification.js";

describe("buildClarificationView", () => {
  it("offers the correction and translate-as-written, and says the word was not recognized", () => {
    const view = buildClarificationView(
      {
        reason: "unrecognized_word",
        params: { word: "helo", lang: "en" },
        options: [
          { kind: "typo_correction", label: "hello", value: "hello", correctedText: "hello" },
          { kind: "translate_as_written", value: "as_written" },
        ],
      },
      "en",
      "ru",
      ["en", "cs"],
    );
    expect(view.message).toContain("helo");
    expect(view.options).toEqual([
      { kind: "typo_correction", label: "hello", value: "hello", langCode: null, correctedText: "hello" },
      { kind: "translate_as_written", label: null, value: "as_written", langCode: null, correctedText: null },
    ]);
    expect(view.languages).toEqual([]);
  });

  it("offers the user's languages when the language is the question and none was suggested", () => {
    const view = buildClarificationView({ reason: "source_language", options: [] }, "ru", "ru", ["en", "cs"]);
    expect(view.languages).toEqual(["ru", "en", "cs"]);
  });

  it("keeps the model's explanation, but not one that leaks prompt terms", () => {
    const own = buildClarificationView({ reason: "word_sense", message: "Какое значение?" }, "ru", "ru", ["en"]);
    expect(own.message).toBe("Какое значение?");
    const leaked = buildClarificationView({ reason: "word_sense", message: "sourceLang unclear" }, "en", "ru", ["en"]);
    expect(leaked.message).not.toContain("sourceLang");
  });
});

describe("clarifiedTargetLangs", () => {
  it("translates into the user's other languages", () => {
    expect(clarifiedTargetLangs("cs", "ru", ["en", "cs"], ["ru"])).toEqual(["ru", "en"]);
  });
});

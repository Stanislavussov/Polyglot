import { describe, expect, it } from "vitest";
import { parseTranslateInput, type TranslateInputEntity } from "./parse-translate-input.js";

function hashtagEntity(text: string, token: string): TranslateInputEntity {
  const offset = text.indexOf(token);
  if (offset < 0) {
    throw new Error(`Token ${token} not found`);
  }

  return { type: "hashtag", offset, length: token.length };
}

describe("parseTranslateInput", () => {
  it("parses free-form multi-word context after a separator", () => {
    expect(parseTranslateInput("bank :: financial institution")).toEqual({
      text: "bank",
      contextHint: "financial institution",
    });
  });

  it("parses Cyrillic free-form context after a separator", () => {
    expect(parseTranslateInput("замок :: дверной замок, не крепость")).toEqual({
      text: "замок",
      contextHint: "дверной замок, не крепость",
    });
  });

  it("returns empty text for separator-only translation input", () => {
    expect(parseTranslateInput(":: financial institution")).toEqual({
      text: ":: financial institution",
    });
  });

  it("returns empty text when text before the separator is empty", () => {
    expect(parseTranslateInput("  :: financial institution")).toEqual({
      text: "",
      contextHint: "financial institution",
    });
  });

  it("parses a trailing ASCII hashtag as context", () => {
    expect(parseTranslateInput("bank #finance")).toEqual({
      text: "bank",
      contextHint: "finance",
    });
  });

  it("parses multiple trailing hashtags as a comma-separated context", () => {
    expect(parseTranslateInput("bank #river #informal")).toEqual({
      text: "bank",
      contextHint: "river, informal",
    });
  });

  it("turns underscores into spaces", () => {
    expect(parseTranslateInput("interview #job_interview")).toEqual({
      text: "interview",
      contextHint: "job interview",
    });
  });

  it("supports Cyrillic text and markers", () => {
    expect(parseTranslateInput("замок #дверь #дом")).toEqual({
      text: "замок",
      contextHint: "дверь, дом",
    });
  });

  it("returns empty text for marker-only input", () => {
    expect(parseTranslateInput("#finance")).toEqual({
      text: "",
      contextHint: "finance",
    });
  });

  it("keeps non-trailing hashtags in the text", () => {
    expect(parseTranslateInput("translate #finance today")).toEqual({
      text: "translate #finance today",
    });
  });

  it("uses Telegram entity offsets without being confused by emoji", () => {
    const text = "🏦 bank #finance";
    expect(parseTranslateInput(text, [hashtagEntity(text, "#finance")])).toEqual({
      text: "🏦 bank",
      contextHint: "finance",
    });
  });

  it("only strips trailing Telegram hashtag entities", () => {
    const text = "use #finance in a sentence";
    expect(parseTranslateInput(text, [hashtagEntity(text, "#finance")])).toEqual({
      text,
    });
  });

  it("ignores fallback-like text when Telegram did not mark it as a hashtag entity", () => {
    const text = "bank #finance";
    expect(parseTranslateInput(text, [{ type: "bold", offset: 5, length: 8 }])).toEqual({
      text: "bank",
      contextHint: "finance",
    });
  });
});

import { describe, expect, it } from "vitest";
import { resolveTranslationDirection } from "../resolve-direction.js";

describe("resolveTranslationDirection", () => {
  const base = {
    nativeLang: "ru",
    learningLangs: ["cs", "en"],
  };

  // === Native language input → standard direction ===

  it("returns standard direction when native language is detected", () => {
    const result = resolveTranslationDirection({
      ...base,
      text: "привет мир это тест",
    });
    expect(result.sourceLang).toBe("ru");
    expect(result.targetLangs).toEqual(["cs", "en"]);
    expect(result.detectedLang).toBe("ru");
  });

  // === Learning language input → reversed direction ===

  it("reverses direction when English (learning) is detected", () => {
    const result = resolveTranslationDirection({
      ...base,
      text: "hello world this is a test",
    });
    expect(result.sourceLang).toBe("en");
    expect(result.targetLangs).toContain("ru");
    expect(result.targetLangs).toContain("cs");
    expect(result.targetLangs).not.toContain("en");
    expect(result.detectedLang).toBe("en");
  });

  it("reverses direction when Czech (learning) is detected", () => {
    const result = resolveTranslationDirection({
      ...base,
      text: "dobrý den jak se máte dnes",
    });
    expect(result.sourceLang).toBe("cs");
    expect(result.targetLangs).toContain("ru");
    expect(result.targetLangs).toContain("en");
    expect(result.targetLangs).not.toContain("cs");
    expect(result.detectedLang).toBe("cs");
  });

  // === Unknown / inconclusive input → fallback ===

  it("falls back to standard direction for ambiguous short input", () => {
    // "hello" is a single Latin word, both "en" and "cs" use Latin → ambiguous
    const result = resolveTranslationDirection({
      ...base,
      text: "hello",
    });
    // Falls back to native → learning
    expect(result.sourceLang).toBe("ru");
    expect(result.targetLangs).toEqual(["cs", "en"]);
    expect(result.detectedLang).toBeUndefined();
  });

  it("falls back for empty text", () => {
    const result = resolveTranslationDirection({
      ...base,
      text: "",
    });
    expect(result.sourceLang).toBe("ru");
    expect(result.targetLangs).toEqual(["cs", "en"]);
    expect(result.detectedLang).toBeUndefined();
  });

  it("falls back for numbers/emoji", () => {
    const result = resolveTranslationDirection({
      ...base,
      text: "12345",
    });
    expect(result.sourceLang).toBe("ru");
    expect(result.targetLangs).toEqual(["cs", "en"]);
    expect(result.detectedLang).toBeUndefined();
  });

  // === Single learning language ===

  it("handles single learning language: detected=learning → targets=[native]", () => {
    const result = resolveTranslationDirection({
      text: "hello world this is a test",
      nativeLang: "ru",
      learningLangs: ["en"],
    });
    expect(result.sourceLang).toBe("en");
    expect(result.targetLangs).toEqual(["ru"]);
    expect(result.detectedLang).toBe("en");
  });

  it("handles single learning language: native input → targets=[learning]", () => {
    const result = resolveTranslationDirection({
      text: "привет мир это тест",
      nativeLang: "ru",
      learningLangs: ["en"],
    });
    expect(result.sourceLang).toBe("ru");
    expect(result.targetLangs).toEqual(["en"]);
    expect(result.detectedLang).toBe("ru");
  });

  // === Multiple learning languages ===

  it("removes only the detected language from targets when reversing", () => {
    const result = resolveTranslationDirection({
      text: "hello world this is a test",
      nativeLang: "ru",
      learningLangs: ["cs", "en", "de"],
    });
    expect(result.sourceLang).toBe("en");
    // Targets should be [native, ...remaining learning]
    expect(result.targetLangs).toEqual(["ru", "cs", "de"]);
    expect(result.detectedLang).toBe("en");
  });

  // === Script heuristic: Cyrillic single word ===

  it("detects Cyrillic single word as native (ru) with script heuristic", () => {
    const result = resolveTranslationDirection({
      ...base,
      text: "привет",
    });
    // "ru" is the only Cyrillic candidate → detected as "ru"
    expect(result.sourceLang).toBe("ru");
    expect(result.targetLangs).toEqual(["cs", "en"]);
    expect(result.detectedLang).toBe("ru");
  });

  // === Edge case: no learning languages ===

  it("handles empty learning languages", () => {
    const result = resolveTranslationDirection({
      text: "hello",
      nativeLang: "en",
      learningLangs: [],
    });
    expect(result.sourceLang).toBe("en");
    expect(result.targetLangs).toEqual([]);
    // Single candidate "en" → detected as "en"
    expect(result.detectedLang).toBe("en");
  });
});

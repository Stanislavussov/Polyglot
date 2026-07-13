import { describe, expect, it } from "vitest";
import { resolveDirectionFromSource, resolveTranslationDirection } from "../resolve-direction.js";

describe("resolveTranslationDirection", () => {
  const base = {
    nativeLang: "ru",
    learningLangs: ["cs", "en"],
  };

  // === Native language input → learning-language targets ===

  it("returns learning-language targets when native language is detected", () => {
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
    expect(result.targetLangs).toEqual(["ru", "cs"]);
    expect(result.targetLangs).toContain("ru");
    expect(result.targetLangs).not.toContain("en");
    expect(result.detectedLang).toBe("en");
  });

  it("reverses direction when Czech (learning) is detected", () => {
    const result = resolveTranslationDirection({
      ...base,
      text: "dobrý den jak se máš dnes",
    });
    expect(result.sourceLang).toBe("cs");
    expect(result.targetLangs).toEqual(["ru", "en"]);
    expect(result.targetLangs).toContain("ru");
    expect(result.targetLangs).not.toContain("cs");
    expect(result.detectedLang).toBe("cs");
  });

  // === Unknown / inconclusive input → script-aware fallback ===

  it("falls back to English for an ambiguous Latin word when native is Cyrillic", () => {
    // "hello" is a single Latin word, both "en" and "cs" use Latin → ambiguous.
    // Latin script rules out the Cyrillic native language, so the fallback
    // must pick a script-compatible learning language (English preferred).
    const result = resolveTranslationDirection({
      ...base,
      text: "hello",
    });
    expect(result.sourceLang).toBe("en");
    expect(result.targetLangs).toEqual(["ru", "cs"]);
    expect(result.detectedLang).toBeUndefined();
  });

  it("falls back to the first script-compatible learning language when English is not studied", () => {
    // Latin word, native ru (Cyrillic), learning cs+de (both Latin) → cs wins by config order.
    const result = resolveTranslationDirection({
      text: "Doom",
      nativeLang: "ru",
      learningLangs: ["cs", "de"],
    });
    expect(result.sourceLang).toBe("cs");
    expect(result.targetLangs).toEqual(["ru", "de"]);
    expect(result.detectedLang).toBeUndefined();
  });

  it("prefers English over config order for an ambiguous Latin word", () => {
    // Real-world regression: "Doom" for a ru-native user learning en+cs+de fell
    // back to sourceLang=ru and hit the unrecognized-word guard ("не похоже на
    // обычное слово в языке Русский").
    const result = resolveTranslationDirection({
      text: "Doom",
      nativeLang: "ru",
      learningLangs: ["cs", "en", "de"],
    });
    expect(result.sourceLang).toBe("en");
    expect(result.targetLangs).toEqual(["ru", "cs", "de"]);
    expect(result.detectedLang).toBeUndefined();
  });

  it("keeps the native fallback when the script matches the native language", () => {
    // Cyrillic gibberish stays ru → learning even though detection is inconclusive.
    const result = resolveTranslationDirection({
      text: "хзйцкь",
      nativeLang: "ru",
      learningLangs: ["uk", "en"],
    });
    expect(result.sourceLang).toBe("ru");
    expect(result.targetLangs).toEqual(["uk", "en"]);
    expect(result.detectedLang).toBeUndefined();
  });

  it("keeps the native fallback when no learning language matches the script", () => {
    // Latin word but the user only studies Japanese → nothing compatible, keep native.
    const result = resolveTranslationDirection({
      text: "Doom",
      nativeLang: "ru",
      learningLangs: ["ja"],
    });
    expect(result.sourceLang).toBe("ru");
    expect(result.targetLangs).toEqual(["ja"]);
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

  it("uses all learning languages as targets when reversing", () => {
    const result = resolveTranslationDirection({
      text: "hello world this is a test",
      nativeLang: "ru",
      learningLangs: ["cs", "en", "de"],
    });
    expect(result.sourceLang).toBe("en");
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

describe("resolveDirectionFromSource", () => {
  const base = {
    nativeLang: "ru",
    learningLangs: ["cs", "en"],
  };

  it("returns learning-lang targets when source is native", () => {
    const result = resolveDirectionFromSource({ ...base, sourceLang: "ru" });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("ru");
    expect(result!.targetLangs).toEqual(["cs", "en"]);
  });

  it("excludes source from targets when source is a learning lang", () => {
    const result = resolveDirectionFromSource({ ...base, sourceLang: "en" });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("en");
    expect(result!.targetLangs).toEqual(["ru", "cs"]);
    expect(result!.targetLangs).not.toContain("en");
  });

  it("returns null when source not in config", () => {
    const result = resolveDirectionFromSource({ ...base, sourceLang: "fr" });
    expect(result).toBeNull();
  });

  it("guard does NOT include source back when single learning lang", () => {
    const result = resolveDirectionFromSource({
      sourceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en"],
    });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("en");
    expect(result!.targetLangs).not.toContain("en");
    expect(result!.targetLangs).toEqual(["ru"]);
  });
});

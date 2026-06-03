import { describe, expect, it } from "vitest";
import { resolveDirectionFromSource } from "../resolve-direction.js";

describe("resolveDirectionFromSource", () => {
  const base = {
    nativeLang: "ru",
    learningLangs: ["cs", "en"],
  };

  // === Source is native language → standard direction ===

  it("returns learning-language targets when source is native language", () => {
    const result = resolveDirectionFromSource({
      ...base,
      sourceLang: "ru",
    });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("ru");
    expect(result!.targetLangs).toEqual(["cs", "en"]);
    expect(result!.detectedLang).toBeUndefined();
  });

  // === Source is a learning language → reverse direction ===

  it("reverses direction when source is Czech (learning lang)", () => {
    const result = resolveDirectionFromSource({
      ...base,
      sourceLang: "cs",
    });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("cs");
    expect(result!.targetLangs).toEqual(["cs", "en"]);
    expect(result!.detectedLang).toBeUndefined();
  });

  it("reverses direction when source is English (learning lang)", () => {
    const result = resolveDirectionFromSource({
      ...base,
      sourceLang: "en",
    });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("en");
    expect(result!.targetLangs).toEqual(["cs", "en"]);
    expect(result!.detectedLang).toBeUndefined();
  });

  // === Invalid source language → null ===

  it("returns null when source lang is not in user config", () => {
    const result = resolveDirectionFromSource({
      ...base,
      sourceLang: "de",
    });
    expect(result).toBeNull();
  });

  it("returns null for empty string source", () => {
    const result = resolveDirectionFromSource({
      ...base,
      sourceLang: "",
    });
    expect(result).toBeNull();
  });

  // === Single learning language ===

  it("handles single learning language: source=native → targets=[learning]", () => {
    const result = resolveDirectionFromSource({
      sourceLang: "ru",
      nativeLang: "ru",
      learningLangs: ["en"],
    });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("ru");
    expect(result!.targetLangs).toEqual(["en"]);
  });

  it("handles single learning language: source=learning → targets=[learning]", () => {
    const result = resolveDirectionFromSource({
      sourceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en"],
    });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("en");
    expect(result!.targetLangs).toEqual(["en"]);
  });

  // === Multiple learning languages ===

  it("uses all learning languages as targets with 3+ learning langs", () => {
    const result = resolveDirectionFromSource({
      sourceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en", "de"],
    });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("en");
    expect(result!.targetLangs).toEqual(["cs", "en", "de"]);
  });

  // === Edge cases ===

  it("handles empty learning languages with native source", () => {
    const result = resolveDirectionFromSource({
      sourceLang: "en",
      nativeLang: "en",
      learningLangs: [],
    });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("en");
    expect(result!.targetLangs).toEqual([]);
  });

  it("returns null when source is not native and not in empty learning langs", () => {
    const result = resolveDirectionFromSource({
      sourceLang: "cs",
      nativeLang: "en",
      learningLangs: [],
    });
    expect(result).toBeNull();
  });

  it("detectedLang is always undefined (explicit source, no detection)", () => {
    const result = resolveDirectionFromSource({
      ...base,
      sourceLang: "cs",
    });
    expect(result).not.toBeNull();
    expect(result!.detectedLang).toBeUndefined();
  });

  // === Task 17 example scenarios ===

  it("scenario: user selects Czech → translates to cs + en", () => {
    // User config: nativeLang: "ru", learningLangs: ["cs", "en"]
    const result = resolveDirectionFromSource({
      sourceLang: "cs",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("cs");
    expect(result!.targetLangs).toEqual(["cs", "en"]);
  });

  it("scenario: user selects Russian → translates to cs + en", () => {
    const result = resolveDirectionFromSource({
      sourceLang: "ru",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("ru");
    expect(result!.targetLangs).toEqual(["cs", "en"]);
  });

  it("scenario: user selects English → translates to cs + en", () => {
    const result = resolveDirectionFromSource({
      sourceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
    expect(result).not.toBeNull();
    expect(result!.sourceLang).toBe("en");
    expect(result!.targetLangs).toEqual(["cs", "en"]);
  });

  it("scenario: stale source lang removed from config → returns null", () => {
    // User had "de" selected, then removed German from learningLangs
    const result = resolveDirectionFromSource({
      sourceLang: "de",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
    expect(result).toBeNull();
  });
});

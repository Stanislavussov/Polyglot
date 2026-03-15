import { describe, it, expect } from "vitest";
import { validateLanguage, resolveToIso3 } from "../validators/language.validator.js";

describe("resolveToIso3", () => {
  it("resolves ISO 639-1 codes", () => {
    expect(resolveToIso3("en")).toBe("eng");
    expect(resolveToIso3("cs")).toBe("ces");
    expect(resolveToIso3("ru")).toBe("rus");
    expect(resolveToIso3("de")).toBe("deu");
  });

  it("resolves full language names", () => {
    expect(resolveToIso3("english")).toBe("eng");
    expect(resolveToIso3("Czech")).toBe("ces");
    expect(resolveToIso3("Russian")).toBe("rus");
  });

  it("resolves ISO 639-3 pass-through", () => {
    expect(resolveToIso3("eng")).toBe("eng");
    expect(resolveToIso3("ces")).toBe("ces");
  });

  it("returns undefined for unknown languages", () => {
    expect(resolveToIso3("xyz")).toBeUndefined();
    expect(resolveToIso3("klingon")).toBeUndefined();
  });
});

describe("validateLanguage", () => {
  it("skips validation for short text (<15 chars)", () => {
    const result = validateLanguage("ahoj", "cs");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("skips validation for empty text", () => {
    const result = validateLanguage("", "en");
    expect(result.valid).toBe(true);
  });

  it("skips validation for unknown expected language", () => {
    const result = validateLanguage(
      "This is a long enough English sentence for testing purposes",
      "xyzlang",
    );
    expect(result.valid).toBe(true);
  });

  it("passes for correct English text", () => {
    const result = validateLanguage(
      "The quick brown fox jumps over the lazy dog and runs away into the forest",
      "en",
    );
    expect(result.valid).toBe(true);
  });

  it("passes for correct English text with full name", () => {
    const result = validateLanguage(
      "The quick brown fox jumps over the lazy dog and runs away into the forest",
      "english",
    );
    expect(result.valid).toBe(true);
  });

  it("detects language mismatch", () => {
    // Spanish text being validated as English
    const result = validateLanguage(
      "El rápido zorro marrón salta sobre el perro perezoso y corre hacia el bosque",
      "en",
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].rule).toBe("language");
    expect(result.errors[0].field).toBe("text");
  });

  it("sets proper error fields", () => {
    const result = validateLanguage(
      "Das ist ein langer deutscher Satz für die Überprüfung der Spracherkennungsfunktion",
      "en",
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].rule).toBe("language");
  });
});

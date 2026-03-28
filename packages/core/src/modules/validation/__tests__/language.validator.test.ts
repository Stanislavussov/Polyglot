import { describe, expect, it } from "vitest";
import { resolveToIso3, validateLanguage } from "../validators/language.validator.js";

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
  it("always returns valid (no-op — franc-min removed due to unreliability)", () => {
    // Previously franc-min produced false positives for short texts:
    // Czech detected as German, Spanish, Somali, etc.
    // Language correctness is ensured by AI prompt + Zod schema.
    const result = validateLanguage("nechat si narůst vousy", "cs");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid for any language input", () => {
    expect(validateLanguage("any text", "en").valid).toBe(true);
    expect(validateLanguage("", "cs").valid).toBe(true);
    expect(validateLanguage("long enough text for testing", "xyz").valid).toBe(true);
  });
});

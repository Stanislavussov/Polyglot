import { describe, expect, it } from "vitest";
import { validateLanguage } from "../validators/language.validator.js";

// NOTE: resolveToIso3 has been removed. ISO 639-3 codes are now a private
// implementation detail of detect-language.ts.

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

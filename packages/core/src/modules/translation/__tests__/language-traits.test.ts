import { describe, expect, it } from "vitest";
import {
  buildLanguageTraitsHint,
  getLanguageTraits,
  LANGUAGE_TRAITS,
  MAX_DIRECTIVE_LENGTH,
} from "../language-traits.js";
import { buildSingleLanguagePrompt, buildTranslationPrompt } from "../prompt.builder.js";

/** Languages flagged is_supported in the DB seed (0002 + 0040). */
const SUPPORTED_CODES = ["en", "ru", "uk", "cs", "pl", "de", "fr", "es", "it", "pt", "kk"];

describe("language traits", () => {
  it("covers every supported language with a non-empty directive", () => {
    for (const code of SUPPORTED_CODES) {
      const traits = getLanguageTraits(code);
      expect(traits, `missing traits for ${code}`).toBeDefined();
      expect(traits?.directive.length).toBeGreaterThan(0);
    }
  });

  it("keeps every directive within the lite-model token budget", () => {
    for (const traits of Object.values(LANGUAGE_TRAITS)) {
      expect(traits.directive.length, `${traits.code} directive too long`).toBeLessThanOrEqual(MAX_DIRECTIVE_LENGTH);
    }
  });

  it("keeps the all-languages hint compact", () => {
    const hint = buildLanguageTraitsHint(SUPPORTED_CODES);
    expect(hint.length).toBeLessThan(1600);
  });
});

describe("buildLanguageTraitsHint", () => {
  it("injects only the requested language, not the whole table", () => {
    const hint = buildLanguageTraitsHint(["de"]);
    expect(hint).toContain("- de:");
    expect(hint).not.toContain("- ru:");
    expect(hint).not.toContain("- kk:");
  });

  it("returns empty string for unknown codes", () => {
    expect(buildLanguageTraitsHint(["xx"])).toBe("");
  });

  it("emits only known codes when mixed with unknown ones", () => {
    const hint = buildLanguageTraitsHint(["de", "xx"]);
    expect(hint).toContain("- de:");
    expect(hint).not.toContain("xx");
  });
});

describe("prompt integration", () => {
  const baseRequest = {
    text: "patient",
    sourceLang: "en",
    targetLangs: ["kk"],
    inputType: "word" as const,
  };

  it("includes the target language directive in the per-language prompt", () => {
    const prompt = buildSingleLanguagePrompt(baseRequest, "kk");
    expect(prompt).toContain("vowel-harmony");
    expect(prompt).not.toContain("der/die/das");
  });

  it("lists one directive per requested target in the base prompt", () => {
    const prompt = buildTranslationPrompt({ ...baseRequest, targetLangs: ["de", "fr"] });
    expect(prompt).toContain("- de:");
    expect(prompt).toContain("- fr:");
    expect(prompt).not.toContain("- kk:");
  });
});

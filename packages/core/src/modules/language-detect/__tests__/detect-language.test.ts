import { describe, expect, it } from "vitest";
import {
  AIStrategy,
  DiacriticsStrategy,
  detectLanguage,
  detectLanguageAsync,
  FrancStrategy,
  ISO1_TO_ISO3,
  ScriptStrategy,
  WiktionaryStrategy,
} from "../detect-language.js";

describe("detectLanguage", () => {
  // === Empty / edge cases ===

  it("returns undefined for empty text", () => {
    expect(detectLanguage("", ["en", "ru", "cs"])).toBeUndefined();
  });

  it("returns undefined for whitespace-only text", () => {
    expect(detectLanguage("   ", ["en", "ru", "cs"])).toBeUndefined();
  });

  it("returns undefined for no candidates", () => {
    expect(detectLanguage("hello", [])).toBeUndefined();
  });

  it("returns undefined for numbers/emoji only", () => {
    expect(detectLanguage("12345", ["en", "ru"])).toBeUndefined();
    expect(detectLanguage("🎉🎊", ["en", "ru"])).toBeUndefined();
  });

  // === Single candidate ===

  it("returns the only candidate when text has letters", () => {
    expect(detectLanguage("hello", ["en"])).toBe("en");
    expect(detectLanguage("привет", ["ru"])).toBe("ru");
  });

  // === Diacritics-based detection (catches words like "dobrý", "příliš") ===

  it("detects Czech from 'dobrý' using diacritics", () => {
    // "ý" is Czech diacritic
    expect(detectLanguage("dobrý", ["en", "ru", "cs"])).toBe("cs");
  });

  it("detects Czech from 'příliš' using diacritics", () => {
    // "ř" and "í" are Czech diacritics
    expect(detectLanguage("příliš", ["en", "cs"])).toBe("cs");
  });

  it("detects Hungarian from 'ű' diacritic", () => {
    expect(detectLanguage("kőszönöm", ["en", "hu"])).toBe("hu");
  });

  it("detects Polish from 'ł' diacritic", () => {
    expect(detectLanguage("łokieć", ["en", "pl"])).toBe("pl");
  });

  it("detects German from 'ü' diacritic", () => {
    expect(detectLanguage("grüß", ["en", "de"])).toBe("de");
  });

  it("detects French from 'ç' diacritic", () => {
    expect(detectLanguage("français", ["en", "fr"])).toBe("fr");
  });

  it("detects Spanish from 'ñ' diacritic", () => {
    expect(detectLanguage("español", ["en", "es"])).toBe("es");
  });

  it("detects Turkish from 'ğ' diacritic", () => {
    expect(detectLanguage("yağmur", ["en", "tr"])).toBe("tr");
  });

  // === "kocour" - requires Wiktionary (no diacritics, but still Czech) ===
  // This test verifies sync detection returns undefined (Wiktionary is async)
  // Use detectLanguageAsync to test Wiktionary detection

  it("returns undefined for 'kocour' in sync mode (no diacritics)", () => {
    // "kocour" has no diacritics, so sync detection can't determine Czech
    expect(detectLanguage("kocour", ["en", "cs"])).toBeUndefined();
  });

  // === Script-based detection ===

  it("detects Russian from Cyrillic when only Cyrillic candidate", () => {
    expect(detectLanguage("привет", ["en", "ru", "cs"])).toBe("ru");
  });

  it("detects Russian from Cyrillic two words", () => {
    expect(detectLanguage("привет мир", ["en", "ru", "cs"])).toBe("ru");
  });

  it("returns undefined for Latin word when multiple Latin candidates (no diacritics)", () => {
    // "hello" has no diacritics, script can't distinguish en from cs
    expect(detectLanguage("hello", ["en", "ru", "cs"])).toBeUndefined();
  });

  it("detects English from Latin word when only Latin candidate", () => {
    expect(detectLanguage("hello", ["en", "ru"])).toBe("en");
  });

  it("returns undefined for ambiguous short input with multiple Cyrillic candidates", () => {
    // Both "ru" and "uk" use Cyrillic
    expect(detectLanguage("привіт", ["en", "ru", "uk"])).toBeUndefined();
  });

  // === Franc-based detection (3+ words) ===

  it("detects Russian from longer Cyrillic text", () => {
    expect(detectLanguage("привет мир это тест", ["en", "ru", "cs"])).toBe("ru");
  });

  it("detects English from longer Latin text", () => {
    expect(detectLanguage("hello world this is a test", ["en", "ru", "cs"])).toBe("en");
  });

  it("detects Czech from longer Czech text with diacritics", () => {
    expect(detectLanguage("dobrý den jak se máte dnes", ["en", "ru", "cs"])).toBe("cs");
  });

  // === Script detection edge cases ===

  it("detects Greek script when el is a candidate", () => {
    expect(detectLanguage("γεια", ["en", "el"])).toBe("el");
  });

  it("detects Arabic script when ar is a candidate", () => {
    expect(detectLanguage("مرحبا", ["en", "ar"])).toBe("ar");
  });

  it("detects CJK script for Chinese when zh is the only CJK candidate", () => {
    expect(detectLanguage("你好", ["en", "zh"])).toBe("zh");
  });

  it("returns undefined for CJK when both zh and ja are candidates", () => {
    expect(detectLanguage("世界", ["zh", "ja"])).toBeUndefined();
  });

  it("detects Korean (Hangul) script", () => {
    expect(detectLanguage("안녕", ["en", "ko"])).toBe("ko");
  });
});

describe("DiacriticsStrategy", () => {
  const strategy = new DiacriticsStrategy();

  it("detects Czech words with ǒ (NOT 'kocour' which has no diacritics)", () => {
    // "kocour" has no diacritics - test with "příliš" instead
    expect(strategy.detect("příliš", ["en", "cs"])).toBe("cs");
  });

  it("detects multiple Czech diacritics", () => {
    expect(strategy.detect("kůň", ["en", "cs"])).toBe("cs");
  });

  it("returns undefined for plain English", () => {
    expect(strategy.detect("hello", ["en", "cs"])).toBeUndefined();
  });

  it("returns undefined when no diacritics match", () => {
    expect(strategy.detect("generic", ["en", "ru", "cs"])).toBeUndefined();
  });

  it("detects 'kocour' as undefined (no diacritics)", () => {
    // This is correct behavior - kocour needs Wiktionary, not diacritics
    expect(strategy.detect("kocour", ["en", "cs"])).toBeUndefined();
  });
});

describe("ScriptStrategy", () => {
  const strategy = new ScriptStrategy();

  it("detects Cyrillic", () => {
    expect(strategy.detect("привет", ["en", "ru"])).toBe("ru");
  });

  it("detects Latin", () => {
    expect(strategy.detect("hello", ["en", "ru"])).toBe("en");
  });

  it("returns undefined for ambiguous Latin (multiple Latin candidates)", () => {
    expect(strategy.detect("hello", ["en", "cs", "de"])).toBeUndefined();
  });
});

describe("FrancStrategy", () => {
  const strategy = new FrancStrategy();

  it("returns undefined for short text (< 3 words)", () => {
    expect(strategy.detect("hello", ["en", "cs"])).toBeUndefined();
    expect(strategy.detect("hello world", ["en", "cs"])).toBeUndefined();
  });

  it("detects language for longer text", () => {
    expect(strategy.detect("hello world this is a test", ["en", "cs"])).toBe("en");
  });
});

describe("WiktionaryStrategy", () => {
  it("detects 'kocour' as Czech when in dictionary", async () => {
    const mockLookup = async (word: string, lang: string) => {
      if (word === "kocour" && lang === "cs") {
        return [
          {
            matchType: "lemma" as const,
            context: { word: "kocour", pos: "noun", glosses: ["cat"], formTags: [], langCode: "cs" },
          },
        ];
      }
      return [];
    };

    const strategy = new WiktionaryStrategy(mockLookup);
    const result = await strategy.detect("kocour", ["en", "cs"]);
    expect(result).toBe("cs");
  });

  it("returns undefined when word not in any candidate language", async () => {
    const mockLookup = async () => [];
    const strategy = new WiktionaryStrategy(mockLookup);
    const result = await strategy.detect("xyznonexistent", ["en", "cs"]);
    expect(result).toBeUndefined();
  });

  it("returns undefined for multi-word text (Wiktionary is for single words)", async () => {
    const mockLookup = async () => [
      {
        matchType: "lemma" as const,
        context: { word: "x", pos: "n", glosses: [], formTags: [], langCode: "cs" },
      },
    ];
    const strategy = new WiktionaryStrategy(mockLookup);
    const result = await strategy.detect("hello world", ["en", "cs"]);
    expect(result).toBeUndefined();
  });
});

describe("AIStrategy", () => {
  it("returns AI-detected language", async () => {
    const mockGenerate = async (prompt: string) => {
      if (prompt.includes("kocour")) return "cs";
      return "en";
    };

    const strategy = new AIStrategy(mockGenerate);
    const result = await strategy.detect("kocour", ["en", "cs"]);
    expect(result).toBe("cs");
  });

  it("returns undefined for single candidate", async () => {
    const mockGenerate = async () => "en";
    const strategy = new AIStrategy(mockGenerate);
    const result = await strategy.detect("hello", ["en"]);
    expect(result).toBeUndefined();
  });

  it("returns undefined when AI returns non-matching code", async () => {
    const mockGenerate = async () => "de"; // Not in candidates
    const strategy = new AIStrategy(mockGenerate);
    const result = await strategy.detect("hello", ["en", "cs"]);
    expect(result).toBeUndefined();
  });
});

describe("detectLanguageAsync", () => {
  it("detects 'kocour' as Czech using Wiktionary", async () => {
    const mockLookup = async (word: string, lang: string) => {
      if (word === "kocour" && lang === "cs") {
        return [
          {
            matchType: "lemma" as const,
            context: { word: "kocour", pos: "noun", glosses: ["cat"], formTags: [], langCode: "cs" },
          },
        ];
      }
      return [];
    };

    const result = await detectLanguageAsync("kocour", ["en", "cs"], {
      contextLookup: mockLookup,
    });

    expect(result).toBe("cs");
  });

  it("falls back to AI when Wiktionary fails", async () => {
    const mockLookup = async () => [];
    const mockGenerate = async () => "cs";

    const result = await detectLanguageAsync("kocour", ["en", "cs"], {
      contextLookup: mockLookup,
      aiGenerate: mockGenerate,
    });

    expect(result).toBe("cs");
  });

  it("returns undefined when all strategies fail", async () => {
    const mockLookup = async () => [];
    const mockGenerate = async () => "de"; // Not in candidates

    const result = await detectLanguageAsync("xyzabc", ["en", "cs"], {
      contextLookup: mockLookup,
      aiGenerate: mockGenerate,
    });

    expect(result).toBeUndefined();
  });
});

describe("ISO1_TO_ISO3 mapping", () => {
  it("contains all supported languages", () => {
    const supported = ["en", "ru", "cs", "de", "fr", "es", "it", "pt", "uk", "pl"];
    for (const lang of supported) {
      expect(ISO1_TO_ISO3[lang]).toBeDefined();
    }
  });

  it("maps Czech correctly", () => {
    expect(ISO1_TO_ISO3.cs).toBe("ces");
  });
});

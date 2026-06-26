import { describe, expect, it, vi } from "vitest";
import { detectLanguageWithConfidence, detectLanguageWithConfidenceAsync } from "../detect-language.js";

describe("detectLanguageWithConfidence", () => {
  // === Edge cases ===

  it("returns zero-confidence result for empty text", () => {
    const result = detectLanguageWithConfidence("", ["en", "cs"]);
    expect(result.language).toBeUndefined();
    expect(result.confidence).toBe(0);
    expect(result.evidence).toEqual([]);
  });

  it("returns zero-confidence result for no candidates", () => {
    const result = detectLanguageWithConfidence("hello", []);
    expect(result.language).toBeUndefined();
    expect(result.confidence).toBe(0);
  });

  it("returns full confidence for single candidate with letters", () => {
    const result = detectLanguageWithConfidence("hello", ["en"]);
    expect(result.language).toBe("en");
    expect(result.confidence).toBe(1);
  });

  // === Script-based detection ===

  it("detects Russian from Cyrillic with high confidence", () => {
    const result = detectLanguageWithConfidence("привет", ["en", "ru"]);
    expect(result.language).toBe("ru");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("detects English from Latin when only Latin candidate", () => {
    const result = detectLanguageWithConfidence("hello", ["en", "ru"]);
    expect(result.language).toBe("en");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  // === Close-language disambiguation: cs/sk ===

  it("detects Czech from unique diacritic ý (not in Slovak pattern)", () => {
    const result = detectLanguageWithConfidence("dobrý", ["en", "cs", "sk"]);
    expect(result.language).toBe("cs");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("detects Czech from ř (unique to Czech, not Slovak)", () => {
    const result = detectLanguageWithConfidence("příliš", ["en", "cs", "sk"]);
    expect(result.language).toBe("cs");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("returns ambiguous for cs/sk shared word without distinguishing diacritics", () => {
    const result = detectLanguageWithConfidence("dobre", ["en", "cs", "sk"]);
    expect(result.language).toBeUndefined();
    expect(result.ambiguousCandidates).toBeDefined();
    expect(result.ambiguousCandidates).toContain("cs");
    expect(result.ambiguousCandidates).toContain("sk");
  });

  // === Close-language disambiguation: hr/sr ===

  it("returns ambiguous for hr/sr shared word 'dobar' (no distinguishing diacritics)", () => {
    const result = detectLanguageWithConfidence("dobar", ["en", "hr", "sr"]);
    expect(result.language).toBeUndefined();
    expect(result.ambiguousCandidates).toBeDefined();
  });

  // === Close-language disambiguation: ru/uk ===

  it("returns ambiguous for ru/uk shared Cyrillic word", () => {
    const result = detectLanguageWithConfidence("привіт", ["en", "ru", "uk"]);
    expect(result.language).toBeUndefined();
    expect(result.ambiguousCandidates).toBeDefined();
    expect(result.ambiguousCandidates).toContain("ru");
    expect(result.ambiguousCandidates).toContain("uk");
  });

  // === Diacritics detection ===

  it("detects Hungarian from ű diacritic", () => {
    const result = detectLanguageWithConfidence("kőszönöm", ["en", "hu"]);
    expect(result.language).toBe("hu");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("detects Polish from ł diacritic", () => {
    const result = detectLanguageWithConfidence("łokieć", ["en", "pl"]);
    expect(result.language).toBe("pl");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("detects German from ü diacritic", () => {
    const result = detectLanguageWithConfidence("grüß", ["en", "de"]);
    expect(result.language).toBe("de");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  // === Franc detection (3+ words) ===

  it("detects English from longer Latin text via franc", () => {
    const result = detectLanguageWithConfidence("hello world this is a test", ["en", "ru", "cs"]);
    expect(result.language).toBe("en");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("detects Czech from longer Czech text with diacritics", () => {
    const result = detectLanguageWithConfidence("dobrý den jak se máte dnes", ["en", "ru", "cs"]);
    expect(result.language).toBe("cs");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  // === Ambiguous cases ===

  it("returns ambiguous for Latin word with multiple Latin candidates and no diacritics", () => {
    const result = detectLanguageWithConfidence("hello", ["en", "cs", "de"]);
    expect(result.language).toBeUndefined();
    expect(result.ambiguousCandidates).toBeDefined();
  });

  it("returns ambiguous for fast (en/de homograph)", () => {
    const result = detectLanguageWithConfidence("fast", ["en", "de"]);
    expect(result.language).toBeUndefined();
    expect(result.ambiguousCandidates).toBeDefined();
  });

  // === Evidence trail ===

  it("includes evidence entries from contributing strategies", () => {
    const result = detectLanguageWithConfidence("příliš", ["en", "cs"]);
    expect(result.evidence.length).toBeGreaterThan(0);
    const diacriticsEvidence = result.evidence.find((e) => e.strategy === "diacritics");
    expect(diacriticsEvidence).toBeDefined();
    expect(diacriticsEvidence?.candidate).toBe("cs");
  });

  it("includes script evidence for shared-script candidates", () => {
    const result = detectLanguageWithConfidence("hello", ["en", "cs", "de"]);
    const scriptEvidence = result.evidence.filter((e) => e.strategy === "script");
    expect(scriptEvidence.length).toBeGreaterThan(0);
  });
});

describe("detectLanguageWithConfidenceAsync", () => {
  it("returns early when sync strategies are confident", async () => {
    const result = await detectLanguageWithConfidenceAsync("příliš", ["en", "cs"], {});
    expect(result.language).toBe("cs");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("uses Wiktionary to resolve ambiguous single word", async () => {
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

    const result = await detectLanguageWithConfidenceAsync("kocour", ["en", "cs"], {
      contextLookup: mockLookup,
    });

    expect(result.language).toBe("cs");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("returns ambiguous when Wiktionary finds word in multiple candidates", async () => {
    const mockLookup = async (word: string, lang: string) => {
      if (word === "fast" && (lang === "en" || lang === "de")) {
        return [
          {
            matchType: "lemma" as const,
            context: { word: "fast", pos: "word", glosses: ["test"], formTags: [], langCode: lang },
          },
        ];
      }
      return [];
    };

    const result = await detectLanguageWithConfidenceAsync("fast", ["en", "de"], {
      contextLookup: mockLookup,
    });

    expect(result.language).toBeUndefined();
    expect(result.ambiguousCandidates).toBeDefined();
  });

  it("keeps en/de homographs ambiguous when English is duplicated in candidates", async () => {
    const mockLookup = async (word: string, lang: string) => {
      if (word === "fast" && (lang === "en" || lang === "de")) {
        return [
          {
            matchType: "lemma" as const,
            context: { word: "fast", pos: "word", glosses: ["test"], formTags: [], langCode: lang },
          },
        ];
      }
      return [];
    };

    const result = await detectLanguageWithConfidenceAsync("fast", ["en", "ru", "en", "de"], {
      contextLookup: mockLookup,
    });

    expect(result.language).toBeUndefined();
    expect(result.ambiguousCandidates).toEqual(expect.arrayContaining(["en", "de"]));
  });

  it("keeps shared-script short words ambiguous when dictionary data only matches English", async () => {
    const mockLookup = vi.fn(async (word: string, lang: string) => {
      if (word === "fast" && lang === "en") {
        return [
          {
            matchType: "lemma" as const,
            context: { word: "fast", pos: "word", glosses: ["quick"], formTags: [], langCode: lang },
          },
        ];
      }
      return [];
    });

    const result = await detectLanguageWithConfidenceAsync("fast", ["en", "de"], {
      contextLookup: mockLookup,
    });

    expect(result.language).toBeUndefined();
    expect(result.ambiguousCandidates).toEqual(["en", "de"]);
    expect(mockLookup).toHaveBeenCalled();
  });

  it("does not score Dutch from a single i in an English word", () => {
    const result = detectLanguageWithConfidence("hi", ["en", "nl"]);
    expect(result.language).toBeUndefined();
    expect(result.ambiguousCandidates).toEqual(expect.arrayContaining(["en", "nl"]));
  });

  it("uses AI as last resort when all other strategies are inconclusive", async () => {
    const mockGenerate = async () => "cs";
    const result = await detectLanguageWithConfidenceAsync("xyzabc", ["en", "cs"], {
      aiGenerate: mockGenerate,
    });

    expect(result.language).toBe("cs");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("does not call AI when Wiktionary already resolved", async () => {
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
    const mockGenerate = vi.fn(async () => "en");

    await detectLanguageWithConfidenceAsync("kocour", ["en", "cs"], {
      contextLookup: mockLookup,
      aiGenerate: mockGenerate,
    });

    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

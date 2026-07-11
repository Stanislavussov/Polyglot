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

  it("detects Ukrainian from і which is not a Russian letter", () => {
    const result = detectLanguageWithConfidence("привіт", ["en", "ru", "uk"]);
    expect(result.language).toBe("uk");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("returns ambiguous for ru/uk word valid in both alphabets", () => {
    const result = detectLanguageWithConfidence("мама", ["en", "ru", "uk"]);
    expect(result.language).toBeUndefined();
    expect(result.ambiguousCandidates).toBeDefined();
    expect(result.ambiguousCandidates).toContain("ru");
    expect(result.ambiguousCandidates).toContain("uk");
  });

  // === Alphabet exclusion (negative evidence) ===

  it("does not claim English for a Latin word with a diacritic outside the English alphabet", () => {
    const result = detectLanguageWithConfidence("Strohá", ["ru", "en"]);
    expect(result.language).toBeUndefined();
  });

  it("alphabet exclusion is case-insensitive", () => {
    const result = detectLanguageWithConfidence("STROHÁ", ["ru", "en"]);
    expect(result.language).toBeUndefined();
  });

  it("keeps the fast path for plain ASCII with a sole Latin candidate", () => {
    const result = detectLanguageWithConfidence("hello", ["ru", "en"]);
    expect(result.language).toBe("en");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("ignores apostrophes when checking the alphabet", () => {
    const result = detectLanguageWithConfidence("don't", ["ru", "en"]);
    expect(result.language).toBe("en");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("narrows shared-script candidates via alphabet exclusion (Größe → de)", () => {
    const result = detectLanguageWithConfidence("Größe", ["en", "de", "fr"]);
    expect(result.language).toBe("de");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("keeps all candidates when exclusion would eliminate every one (safety valve)", () => {
    const result = detectLanguageWithConfidence("ışık", ["en", "es"]);
    expect(result.language).toBeUndefined();
    expect(result.ambiguousCandidates).toEqual(expect.arrayContaining(["en", "es"]));
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

  // === Dictionary sweep (findWordLanguages) — single-word out-of-set ===

  it("flags a single word found only in non-candidate dictionaries as out-of-set", async () => {
    const sweep = vi.fn(async () => ["cs", "sk"]);
    const result = await detectLanguageWithConfidenceAsync("Strohá", ["ru", "en"], {
      findWordLanguages: sweep,
    });

    expect(result.language).toBeUndefined();
    expect(result.outOfSetLanguages).toEqual(["cs", "sk"]);
    expect(sweep).toHaveBeenCalledWith("Strohá");
  });

  it("overrides a confident diacritic-only detection when the dictionary disagrees", async () => {
    // Sync scoring is confident about es (sole Latin candidate + shared á),
    // but the word only exists in Czech/Slovak dictionaries.
    const sweep = vi.fn(async () => ["cs", "sk"]);
    const result = await detectLanguageWithConfidenceAsync("Strohá", ["ru", "es"], {
      findWordLanguages: sweep,
    });

    expect(result.language).toBeUndefined();
    expect(result.outOfSetLanguages).toEqual(["cs", "sk"]);
  });

  it("prefers candidate dictionary matches over out-of-set languages", async () => {
    const sweep = vi.fn(async () => ["en", "es", "it", "pl"]);
    const result = await detectLanguageWithConfidenceAsync("no", ["en", "es"], {
      findWordLanguages: sweep,
    });

    expect(result.outOfSetLanguages).toBeUndefined();
    expect(result.language).toBeUndefined();
    expect(result.ambiguousCandidates).toEqual(expect.arrayContaining(["en", "es"]));
  });

  it("resolves a unique candidate dictionary match (résumé → en)", async () => {
    const sweep = vi.fn(async () => ["en", "fr"]);
    const result = await detectLanguageWithConfidenceAsync("résumé", ["ru", "en"], {
      findWordLanguages: sweep,
    });

    expect(result.language).toBe("en");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("does not sweep confident ASCII detections", async () => {
    const sweep = vi.fn(async () => []);
    const result = await detectLanguageWithConfidenceAsync("hello", ["ru", "en"], {
      findWordLanguages: sweep,
    });

    expect(result.language).toBe("en");
    expect(sweep).not.toHaveBeenCalled();
  });

  it("keeps a confident detection when the sweep finds nothing (fail-open)", async () => {
    const sweep = vi.fn(async () => []);
    const result = await detectLanguageWithConfidenceAsync("Strohá", ["ru", "es"], {
      findWordLanguages: sweep,
    });

    expect(result.language).toBe("es");
  });

  it("treats a throwing sweep as empty", async () => {
    const sweep = vi.fn(async () => {
      throw new Error("db down");
    });
    const result = await detectLanguageWithConfidenceAsync("Strohá", ["ru", "es"], {
      findWordLanguages: sweep,
    });

    expect(result.language).toBe("es");
    expect(result.outOfSetLanguages).toBeUndefined();
  });

  // === AI open detection (out-of-set answers) ===

  it("returns out-of-set language when AI names a non-candidate", async () => {
    const sweep = vi.fn(async () => []);
    const mockGenerate = vi.fn(async () => "cs");
    const result = await detectLanguageWithConfidenceAsync("Strohá", ["ru", "en"], {
      findWordLanguages: sweep,
      aiGenerate: mockGenerate,
    });

    expect(result.language).toBeUndefined();
    expect(result.outOfSetLanguages).toEqual(["cs"]);
  });

  it("ignores garbage AI answers", async () => {
    const mockGenerate = vi.fn(async () => "zz-nonsense");
    const result = await detectLanguageWithConfidenceAsync("Strohá", ["ru", "en"], {
      aiGenerate: mockGenerate,
    });

    expect(result.language).toBeUndefined();
    expect(result.outOfSetLanguages).toBeUndefined();
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

// Real-franc behaviour behind US-B (English added to the multi-word sync candidate
// set in translate-flow). These use the REAL detector — no mock — so they document
// what the change actually rescues, and the current franc limitation.
describe("detectLanguageWithConfidence — English among studied Latin candidates (US-B)", () => {
  const candidates = ["en", "ru", "de"];

  it("resolves a phrase franc reads as English to en (rescued by including en)", () => {
    const result = detectLanguageWithConfidence("I will get you", candidates);
    expect(result.language).toBe("en");
  });

  it("resolves a longer English phrase to en", () => {
    const result = detectLanguageWithConfidence("That will get you there", candidates);
    expect(result.language).toBe("en");
  });

  it("still coerces a real German phrase to de (English does not steal it)", () => {
    const result = detectLanguageWithConfidence("Das ist wirklich gut", candidates);
    expect(result.language).toBe("de");
  });

  // franc misreads this very short English phrase as German (deu:1 vs eng:0.78),
  // so the SYNC pass alone still returns de — the candidate set can't fix it. The
  // async AI-arbitration pass (below) is what rescues it in production.
  it("sync alone still returns de for a franc-misread short English phrase", () => {
    const result = detectLanguageWithConfidence("That will get you", candidates);
    expect(result.language).toBe("de");
  });
});

describe("detectLanguageWithConfidenceAsync — AI arbitration overrides franc coercion (US-B)", () => {
  const candidates = ["en", "ru", "de"];

  it("overrides franc's German coercion with the AI's English when they disagree", async () => {
    const aiGenerate = vi.fn().mockResolvedValue("en");
    const result = await detectLanguageWithConfidenceAsync("That will get you", candidates, { aiGenerate });
    expect(result.language).toBe("en");
    expect(aiGenerate).toHaveBeenCalled();
  });

  it("keeps franc's result when the AI agrees with it", async () => {
    const aiGenerate = vi.fn().mockResolvedValue("de");
    const result = await detectLanguageWithConfidenceAsync("That will get you", candidates, { aiGenerate });
    expect(result.language).toBe("de");
  });

  it("keeps franc's result when the AI is inconclusive (ambiguous)", async () => {
    const aiGenerate = vi.fn().mockResolvedValue("ambiguous");
    const result = await detectLanguageWithConfidenceAsync("That will get you", candidates, { aiGenerate });
    expect(result.language).toBe("de");
  });

  it("does NOT arbitrate a LOW-English-affinity German sentence (no AI call)", async () => {
    // This diacritic-heavy sentence scores low franc English-affinity (eng≈0.48),
    // below the 0.7 gate, so no AI call is spent.
    const aiGenerate = vi.fn().mockResolvedValue("en");
    const result = await detectLanguageWithConfidenceAsync("Das Wetter ist heute wirklich schön", candidates, {
      aiGenerate,
    });
    expect(result.language).toBe("de");
    expect(aiGenerate).not.toHaveBeenCalled();
  });

  it("DOES arbitrate a high-English-affinity German sentence, but the agreeing AI keeps it de", async () => {
    // Honest documentation of the accepted over-fire: "Ich liebe dich sehr" scores
    // eng≈0.772 (near the repro's 0.780), so the gate fires and an AI call IS spent —
    // but the AI agrees (de), so franc's result stands. Correctness preserved, one
    // extra short detection call is the accepted cost.
    const aiGenerate = vi.fn().mockResolvedValue("de");
    const result = await detectLanguageWithConfidenceAsync("Ich liebe dich sehr", candidates, { aiGenerate });
    expect(result.language).toBe("de");
    expect(aiGenerate).toHaveBeenCalled();
  });
});

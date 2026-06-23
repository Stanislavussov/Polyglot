import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validate } from "../index.js";

/** Minimal schema matching the BRD translation result structure (Task 31: updated examples) */
const translationResultSchema = z.object({
  emoji: z.string(),
  nativeMeaning: z.string().optional(),
  sourceUsage: z
    .object({
      explanation: z.string(),
      synonyms: z.array(z.object({ text: z.string() })),
      examples: z.array(
        z.object({
          context: z.string(),
          target: z.string(),
          native: z.string().optional(),
        }),
      ),
    })
    .optional(),
  translations: z.record(
    z.string(),
    z.object({
      text: z.string(),
      expressionType: z.enum(["literal", "idiomatic_equivalent"]).optional().default("literal"),
      equivalentNote: z.string().optional(),
      usageNote: z.string().optional(),
      connotationWarning: z.string().optional(),
      synonyms: z.array(z.object({ text: z.string() })),
      examples: z.array(
        z.object({
          context: z.enum(["neutral", "colloquial", "professional"]),
          target: z.string(),
          native: z.string().optional(),
        }),
      ),
    }),
  ),
});

function makeValidResponse(_original: string) {
  return {
    emoji: "👋",
    translations: {
      cs: {
        text: "ahoj",
        synonyms: [{ text: "nazdar" }],
        examples: [
          { context: "neutral" as const, target: "Řekl ahoj svému kolegovi při setkání v kanceláři." },
          { context: "colloquial" as const, target: "Ahoj, jak se máš dneska odpoledne kamaráde?" },
        ],
      },
    },
  };
}

describe("validate (orchestrator)", () => {
  it("returns valid for a correct translation response", () => {
    const raw = makeValidResponse("hello");
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails on schema validation errors", () => {
    const raw = { emoji: "👋" }; // missing required fields
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "schema")).toBe(true);
  });

  it("fails when translation equals original (semantic check)", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "hello", // same as original
          synonyms: [],
          examples: [{ context: "neutral", target: "Hello there, how are you doing today?" }],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
  });

  it("rejects sentence translations that rewrite an ambiguous date token", () => {
    const raw = {
      emoji: "📅",
      translations: {
        de: {
          text: "Treffen wir uns am 7. Juni um 5.",
          synonyms: [],
          examples: [],
        },
      },
    };

    const result = validate(raw, translationResultSchema, "Let's meet on 06/07 at 5.", ["de"], "sentence");
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "immutable",
          field: "translations.de.text",
        }),
      ]),
    );
  });

  it("rejects translations that alter placeholders", () => {
    const raw = {
      emoji: "🧩",
      translations: {
        cs: {
          text: "Ahoj, name! Máš count zpráv.",
          synonyms: [],
          examples: [],
        },
      },
    };

    const result = validate(raw, translationResultSchema, "Hello, {name}! You have {{count}} messages.", ["cs"]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "immutable",
          field: "translations.cs.text",
        }),
      ]),
    );
  });

  it("still runs sentence-level semantic validation for hallucination patterns", () => {
    const raw = {
      emoji: "❌",
      translations: {
        de: {
          text: "I cannot translate this sentence",
          synonyms: [],
          examples: [],
        },
      },
    };

    const result = validate(raw, translationResultSchema, "Could you close the window?", ["de"], "sentence");
    expect(result.errors.some((e) => e.rule === "semantic" && e.field === "translations.de.text")).toBe(true);
  });

  it("reports missing translations for expected languages", () => {
    const raw = makeValidResponse("hello");
    // Expect both cs and en but only cs provided
    const result = validate(raw, translationResultSchema, "hello", ["cs", "en"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "schema" && e.message.includes("Missing translation"))).toBe(true);
  });

  it("stops after schema failure and does not run other validators", () => {
    const raw = "not an object at all";
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(false);
    // Should only have schema errors, not semantic/language/examples
    expect(result.errors.every((e) => e.rule === "schema")).toBe(true);
  });

  it("fails examples when first target example does not contain a simple main translation", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [],
          examples: [{ context: "neutral", target: "Completely unrelated sentence without the word" }],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "examples")).toBe(true);
  });

  it("passes when a same-language learning block changes the source expression", () => {
    const raw = {
      emoji: "🦗",
      translations: {
        cs: {
          text: "klubko",
          synonyms: [],
          examples: [{ context: "neutral", target: "Kočka si hrála s velkým klubkem." }],
        },
        en: {
          text: "ball of yarn",
          synonyms: [],
          examples: [{ context: "neutral", target: "The kitten played with a ball of yarn." }],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "kudlanka", ["cs", "en"], "word", { sourceLang: "cs" });
    expect(result.errors.some((e) => e.field === "translations.cs.text" && e.rule === "semantic")).toBe(false);
  });

  it("fails when a same-language learning block repeats the original expression", () => {
    const raw = {
      emoji: "🦗",
      translations: {
        cs: {
          text: "kudlanka",
          synonyms: [],
          examples: [{ context: "neutral", target: "Kudlanka seděla na listu." }],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "kudlanka", ["cs"], "word", { sourceLang: "cs" });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "semantic",
          field: "translations.cs.text",
        }),
      ]),
    );
  });

  it("validates hallucination patterns", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "N/A",
          synonyms: [],
          examples: [{ context: "neutral", target: "N/A in this sentence" }],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
  });

  it("prefixes error fields with language path", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "hello", // same as original
          synonyms: [],
          examples: [{ context: "neutral", target: "Hello sentence for testing here today" }],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.startsWith("translations.cs."))).toBe(true);
  });

  it("fails when nativeMeaning is missing for nativeLang", () => {
    const raw = {
      emoji: "🙈",
      nativeSynonyms: [],
      translations: {
        cs: {
          text: "být slepý jako patrona",
          connotationWarning: "Výraz je hovorový a může znít nezdvořile.",
          synonyms: [],
          examples: [],
        },
      },
    };

    const result = validate(raw, translationResultSchema, "биться в шары", ["cs"], "phrase", {
      nativeLang: "ru",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "schema",
          field: "nativeMeaning",
        }),
      ]),
    );
  });

  it("rejects a connotation warning written in the target language instead of the native language", () => {
    const raw = {
      emoji: "🙈",
      nativeMeaning: "Разговорное выражение о невнимательности.",
      nativeSynonyms: [],
      translations: {
        cs: {
          text: "být slepý jako patrona",
          connotationWarning: "Výraz je hovorový a může znít nezdvořile.",
          synonyms: [],
          examples: [],
        },
      },
    };

    const result = validate(raw, translationResultSchema, "биться в шары", ["cs"], "phrase", {
      nativeLang: "ru",
    });

    expect(result.errors.some((e) => e.field === "translations.cs.connotationWarning")).toBe(true);
    expect(result.errors.some((e) => e.field === "nativeMeaning")).toBe(false);
  });

  it("rejects a usage note written in the target language instead of the native language", () => {
    const raw = {
      emoji: "🙈",
      nativeMeaning: "Разговорное выражение.",
      translations: {
        cs: {
          text: "prdnout si potichu",
          usageNote: "Používá se jen ve velmi neformální konverzaci.",
          synonyms: [],
          examples: [],
        },
      },
    };

    const result = validate(raw, translationResultSchema, "пустить шептуна", ["cs"], "phrase", {
      nativeLang: "ru",
    });

    expect(result.errors.some((e) => e.field === "translations.cs.usageNote")).toBe(true);
  });

  it("rejects a native example that duplicates the target sentence", () => {
    const raw = {
      emoji: "➡️",
      nativeMeaning: "Постепенно прекратить использование.",
      translations: {
        cs: {
          text: "postupně ukončit",
          synonyms: [],
          examples: [
            {
              context: "neutral",
              target: "Vláda chce postupně ukončit používání plastů.",
              native: "Vláda chce postupně ukončit používání plastů.",
            },
          ],
        },
      },
    };

    const result = validate(raw, translationResultSchema, "phase out", ["cs"], "phrase", {
      nativeLang: "ru",
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "language",
          field: "translations.cs.examples.0.native",
        }),
      ]),
    );
  });

  it("rejects Latin romanization in a Russian native example", () => {
    const raw = {
      emoji: "➡️",
      nativeMeaning: "Постепенно прекратить использование.",
      translations: {
        cs: {
          text: "postupně ukončit",
          synonyms: [],
          examples: [
            {
              context: "neutral",
              target: "Vláda chce postupně ukončit používání plastů.",
              native: "Pravitel'stvo reshilо postepenno otkazat'sya ot plastika.",
            },
          ],
        },
      },
    };

    const result = validate(raw, translationResultSchema, "phase out", ["cs"], "phrase", {
      nativeLang: "ru",
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "language",
          field: "translations.cs.examples.0.native",
        }),
      ]),
    );
  });

  it("rejects a non-Russian nativeMeaning when nativeLang is Russian", () => {
    const raw = {
      emoji: "➡️",
      nativeMeaning: "To gradually stop using something.",
      translations: {
        cs: {
          text: "postupně ukončit",
          synonyms: [],
          examples: [
            {
              context: "neutral",
              target: "Vláda chce postupně ukončit používání plastů.",
              native: "Правительство хочет постепенно отказаться от пластика.",
            },
          ],
        },
      },
    };

    const result = validate(raw, translationResultSchema, "phase out", ["cs"], "phrase", {
      nativeLang: "ru",
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "language",
          field: "nativeMeaning",
        }),
      ]),
    );
  });

  it("rejects embedded IPA pronunciation in an ordinary response field", () => {
    const raw = {
      emoji: "➡️",
      nativeMeaning: "Постепенно прекратить использование. IPA: /feɪz aʊt/",
      translations: {
        cs: {
          text: "postupně ukončit",
          synonyms: [],
          examples: [],
        },
      },
    };

    const result = validate(raw, translationResultSchema, "phase out", ["cs"], "phrase", {
      nativeLang: "ru",
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "format",
          field: "nativeMeaning",
        }),
      ]),
    );
  });

  it("rejects an identical note copied across target-language blocks", () => {
    const duplicatedNote = "Употребляется преимущественно в официальной речи.";
    const raw = {
      emoji: "➡️",
      nativeMeaning: "Постепенно прекратить использование.",
      translations: {
        cs: {
          text: "postupně ukončit",
          connotationWarning: duplicatedNote,
          synonyms: [],
          examples: [],
        },
        de: {
          text: "schrittweise einstellen",
          connotationWarning: duplicatedNote,
          synonyms: [],
          examples: [],
        },
      },
    };

    const result = validate(raw, translationResultSchema, "phase out", ["cs", "de"], "phrase", {
      nativeLang: "ru",
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "duplication",
          field: "translations.de.connotationWarning",
        }),
      ]),
    );
  });
});

/**
 * Single-language validation tests — partial regeneration scenario (Task 07).
 *
 * When translateOne() regenerates a single language, translate() internally calls
 * validate() with expectedLangs: [singleLang]. These tests verify that the
 * orchestrator works correctly with a single expected language.
 */
describe("validate — single-language (partial regeneration)", () => {
  it("passes for a valid single-language response", () => {
    const raw = makeValidResponse("hello");
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes when response contains extra languages beyond the expected one", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [{ text: "nazdar" }],
          examples: [{ context: "neutral" as const, target: "Řekl ahoj svému kolegovi při setkání v kanceláři." }],
        },
        de: {
          text: "hallo",
          synonyms: [{ text: "guten Tag" }],
          examples: [{ context: "neutral" as const, target: "Er sagte hallo zu seinem Kollegen bei dem Treffen." }],
        },
      },
    };
    // Only validate "cs" — "de" is extra and should not cause errors
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects semantic error in a single-language response", () => {
    const raw = {
      emoji: "👋",
      translations: {
        de: {
          text: "hello", // same as original — semantic error
          synonyms: [],
          examples: [{ context: "neutral" as const, target: "Er sagte hello zu seinem Kollegen im Büro heute." }],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["de"]);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rule).toBe("semantic");
    expect(result.errors[0].field).toBe("translations.de.text");
  });

  it("detects hallucination in a single-language response", () => {
    const raw = {
      emoji: "📦",
      translations: {
        fr: {
          text: "I cannot translate this word",
          synonyms: [],
          examples: [{ context: "neutral" as const, target: "Une phrase en français pour tester la validation." }],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "package", ["fr"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
    expect(result.errors.some((e) => e.field?.startsWith("translations.fr."))).toBe(true);
  });

  it("reports missing language when single expected language is absent", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [],
          examples: [{ context: "neutral" as const, target: "Řekl ahoj svému kolegovi při setkání v kanceláři." }],
        },
      },
    };
    // Expect "de" but only "cs" is present
    const result = validate(raw, translationResultSchema, "hello", ["de"]);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rule).toBe("schema");
    expect(result.errors[0].message).toContain("Missing translation");
    expect(result.errors[0].message).toContain("de");
    expect(result.errors[0].field).toBe("translations.de");
  });

  it("validates examples in a single-language response with empty examples", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [],
          examples: [
            {
              context: "neutral" as const,
              target: "", // empty target — examples validation error
            },
          ],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "examples")).toBe(true);
    expect(result.errors.some((e) => e.field?.startsWith("translations.cs."))).toBe(true);
  });
});

/**
 * Idiomatic equivalent validation tests (Task 10).
 *
 * Verifies that the validate() orchestrator correctly passes expressionType
 * to validateExamples() and handles idiomatic equivalents.
 */
describe("validate — idiomatic equivalents (Task 10)", () => {
  it("passes for a response with expressionType 'idiomatic_equivalent'", () => {
    const raw = {
      emoji: "🍰",
      translations: {
        cs: {
          // Longer Czech text so franc-min can reliably detect it as Czech
          text: "Vlk se nažral a koza zůstala celá, to je české přísloví o dosažení obojího",
          expressionType: "idiomatic_equivalent" as const,
          equivalentNote: "Closest Czech equivalent of the English idiom about having both options.",
          synonyms: [],
          examples: [
            {
              context: "colloquial" as const,
              target: "Podařilo se mu dosáhnout obou cílů současně, vlk se nažral a koza zůstala celá.",
            },
          ],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "Having your cake and eating it too", ["cs"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes for idiomatic equivalent where examples don't repeat the phrase verbatim", () => {
    const raw = {
      emoji: "🐦",
      translations: {
        cs: {
          text: "Ranní ptáče dál doskáče",
          expressionType: "idiomatic_equivalent" as const,
          equivalentNote: "Czech equivalent proverb about the value of waking early.",
          synonyms: [],
          examples: [{ context: "neutral" as const, target: "Vstával brzy, a tak měl vždy náskok před ostatními." }],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "The early bird catches the worm", ["cs"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes for literal expressionType with normal examples", () => {
    const raw = makeValidResponse("hello");
    // makeValidResponse doesn't set expressionType, defaults to "literal" via schema
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("still fails for idiomatic equivalent with empty examples", () => {
    const raw = {
      emoji: "🍰",
      translations: {
        cs: {
          text: "Vlk se nažral a koza zůstala celá",
          expressionType: "idiomatic_equivalent" as const,
          equivalentNote: "Czech equivalent proverb.",
          synonyms: [],
          examples: [
            {
              context: "colloquial" as const,
              target: "", // empty target — should still fail
            },
          ],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "Having your cake and eating it too", ["cs"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "examples")).toBe(true);
  });

  it("accepts response without expressionType (backward compatible)", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "ahoj",
          // no expressionType — should default to "literal" or undefined
          synonyms: [{ text: "nazdar" }],
          examples: [{ context: "neutral" as const, target: "Řekl ahoj svému kolegovi při setkání v kanceláři." }],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

/**
 * Alternatives semantic validation tests.
 *
 * Verifies that the validate() orchestrator runs semantic checks
 * on alternative translation variants (alternatives[].text).
 */
describe("validate — alternatives semantic validation", () => {
  it("passes for valid alternatives", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [{ text: "nazdar" }],
          examples: [{ context: "neutral" as const, target: "Řekl ahoj svému kolegovi při setkání v kanceláři." }],
          alternatives: [
            {
              text: "nazdar",
              synonyms: [{ text: "čau" }],
            },
            {
              text: "dobrý den",
              synonyms: [{ text: "zdravím" }],
            },
          ],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes when alternatives field is absent (backward compatible)", () => {
    const raw = makeValidResponse("hello");
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes when alternatives array is empty", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [],
          examples: [{ context: "neutral" as const, target: "Řekl ahoj svému kolegovi při setkání v kanceláři." }],
          alternatives: [],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when alternative text equals original", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [],
          examples: [{ context: "neutral" as const, target: "Řekl ahoj svému kolegovi při setkání v kanceláři." }],
          alternatives: [
            {
              text: "nazdar",
              synonyms: [],
            },
            {
              text: "hello", // same as original — semantic error
              synonyms: [],
            },
          ],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
    expect(result.errors.some((e) => e.field?.includes("alternatives[1]"))).toBe(true);
  });

  it("fails when alternative contains hallucination pattern", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [],
          examples: [{ context: "neutral" as const, target: "Řekl ahoj svému kolegovi při setkání v kanceláři." }],
          alternatives: [
            {
              text: "I cannot translate this",
              synonyms: [],
            },
          ],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
    expect(result.errors.some((e) => e.field?.includes("alternatives[0]"))).toBe(true);
  });

  it("reports correct field path for alternative errors", () => {
    const raw = {
      emoji: "👋",
      translations: {
        de: {
          text: "hallo",
          synonyms: [],
          examples: [{ context: "neutral" as const, target: "Er sagte hallo zu seinem Kollegen im Büro heute." }],
          alternatives: [
            {
              text: "grüß Gott",
              synonyms: [],
            },
            {
              text: "hello", // same as original
              synonyms: [],
            },
          ],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["de"]);
    expect(result.valid).toBe(false);
    const altError = result.errors.find((e) => e.field?.includes("alternatives"));
    expect(altError).toBeDefined();
    expect(altError!.field).toBe("translations.de.alternatives[1].text");
  });
});

/**
 * Sentence input type validation tests (Task 27 — Step 5).
 *
 * When inputType is 'sentence', semantic validation (translation ≠ original,
 * hallucination patterns) and alternatives semantic validation are skipped.
 * Schema validation still runs. Example/language checks run but are naturally
 * skipped when those fields are empty arrays (SENTENCE_OUTPUT preset).
 */
describe("validate — sentence inputType (Task 27)", () => {
  /** Minimal sentence schema — only text */
  const sentenceSchema = z.object({
    emoji: z.string(),
    translations: z.record(
      z.string(),
      z.object({
        text: z.string(),
        synonyms: z.array(z.unknown()).default([]),
        examples: z.array(z.unknown()).default([]),
      }),
    ),
  });

  it("skips semantic validation when inputType is 'sentence' — translation equals original passes", () => {
    const original = "Can you tell me where the nearest pharmacy is";
    const raw = {
      emoji: "💊",
      translations: {
        cs: {
          text: original, // same as original — would fail without sentence mode
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = validate(raw, sentenceSchema, original, ["cs"], "sentence");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("still rejects hallucination patterns when inputType is 'sentence'", () => {
    const raw = {
      emoji: "💊",
      translations: {
        de: {
          text: "N/A", // hallucination pattern — would fail without sentence mode
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = validate(raw, sentenceSchema, "Where is the pharmacy?", ["de"], "sentence");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
  });

  it("still runs schema validation for sentences", () => {
    const raw = { emoji: "💊" }; // missing required fields
    const result = validate(raw, sentenceSchema, "Where is the pharmacy?", ["de"], "sentence");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "schema")).toBe(true);
  });

  it("still reports missing language translations for sentences", () => {
    const raw = {
      emoji: "💊",
      translations: {
        cs: {
          text: "Kde je nejbližší lékárna?",
          synonyms: [],
          examples: [],
        },
      },
    };
    // Expect "de" but only "cs" is present
    const result = validate(raw, sentenceSchema, "Where is the pharmacy?", ["de"], "sentence");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "schema" && e.message.includes("Missing translation"))).toBe(true);
  });

  it("skips alternatives semantic validation for sentences", () => {
    const raw = {
      emoji: "💊",
      translations: {
        cs: {
          text: "Kde je nejbližší lékárna?",
          synonyms: [],
          examples: [],
          alternatives: [
            {
              text: "Where is the pharmacy?", // same as original — would fail without sentence mode
              synonyms: [],
            },
          ],
        },
      },
    };
    const result = validate(raw, sentenceSchema, "Where is the pharmacy?", ["cs"], "sentence");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("runs full semantic validation when inputType is absent (backward compatible)", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "hello", // same as original — should fail
          synonyms: [],
          examples: [],
        },
      },
    };
    // No inputType parameter — full validation
    const result = validate(raw, sentenceSchema, "hello", ["cs"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
  });

  it("runs full semantic validation when inputType is 'word'", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "hello", // same as original — should fail
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = validate(raw, sentenceSchema, "hello", ["cs"], "word");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
  });

  it("runs full semantic validation when inputType is 'phrase'", () => {
    const raw = {
      emoji: "👋",
      translations: {
        cs: {
          text: "good morning", // same as original — should fail
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = validate(raw, sentenceSchema, "good morning", ["cs"], "phrase");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
  });

  it("passes valid sentence translation with multiple languages", () => {
    const raw = {
      emoji: "💊",
      translations: {
        cs: {
          text: "Kde je nejbližší lékárna?",
          synonyms: [],
          examples: [],
        },
        de: {
          text: "Wo ist die nächste Apotheke?",
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = validate(raw, sentenceSchema, "Where is the nearest pharmacy?", ["cs", "de"], "sentence");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── ValidateOptions (output config–driven validation) ──────────────

describe("validate with ValidateOptions", () => {
  /** Schema that relaxes examples (default to []) — mirrors buildLanguageTranslationSchema({ includeExamples: false }) */
  const noExamplesSchema = z.object({
    emoji: z.string(),
    translations: z.record(
      z.string(),
      z.object({
        text: z.string(),
        synonyms: z.array(z.object({ text: z.string() })),
        examples: z.array(z.object({ context: z.string(), target: z.string() })).default([]),
        expressionType: z.enum(["literal", "idiomatic_equivalent"]).optional().default("literal"),
        alternatives: z
          .array(
            z.object({
              text: z.string(),
              synonyms: z.array(z.object({ text: z.string() })),
            }),
          )
          .optional(),
      }),
    ),
  });

  it("skips example validation when includeExamples is false", () => {
    const raw = {
      emoji: "🐻",
      translations: {
        en: {
          text: "beast",
          synonyms: [{ text: "creature" }],
          examples: [], // empty — config says no examples
        },
        cs: {
          text: "zvíře",
          synonyms: [{ text: "bestie" }],
          examples: [], // empty — config says no examples
        },
      },
    };
    const result = validate(raw, noExamplesSchema, "зверюга", ["en", "cs"], undefined, { includeExamples: false });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("still validates examples when includeExamples is not set (defaults to true)", () => {
    const raw = {
      emoji: "🐻",
      translations: {
        en: {
          text: "beast",
          synonyms: [],
          examples: [], // empty — but config doesn't disable examples
        },
      },
    };
    const result = validate(raw, translationResultSchema, "зверюга", ["en"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "examples" && e.message.includes("No examples provided"))).toBe(true);
  });

  it("skips alternatives validation when includeAlternatives is false", () => {
    const raw = {
      emoji: "🐻",
      translations: {
        en: {
          text: "beast",
          synonyms: [],
          examples: [{ context: "colloquial", target: "What a beast!" }],
          // alternatives with hallucinated text — should be ignored when disabled
        },
      },
    };
    const result = validate(raw, translationResultSchema, "зверюга", ["en"], undefined, { includeAlternatives: false });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes when alternatives are absent (optional field)", () => {
    const raw = {
      emoji: "🐻",
      translations: {
        en: {
          text: "beast",
          synonyms: [],
          examples: [{ context: "colloquial", target: "What a beast!" }],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "зверюга", ["en"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("skips both examples and alternatives when both are disabled", () => {
    const raw = {
      emoji: "🐻",
      translations: {
        en: {
          text: "beast",
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = validate(raw, noExamplesSchema, "зверюга", ["en"], undefined, {
      includeExamples: false,
      includeAlternatives: false,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("semantic validation still runs even when examples/alternatives are disabled", () => {
    const raw = {
      emoji: "🐻",
      translations: {
        en: {
          text: "зверюга", // same as original — semantic should catch this
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = validate(raw, noExamplesSchema, "зверюга", ["en"], undefined, {
      includeExamples: false,
      includeAlternatives: false,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
  });
});

describe("validate — minimal native target block (learning-language source)", () => {
  const minimalNativeSchema = z.object({
    emoji: z.string(),
    nativeMeaning: z.string().optional(),
    sourceUsage: z
      .object({
        explanation: z.string(),
        synonyms: z.array(z.object({ text: z.string() })),
        examples: z.array(
          z.object({
            context: z.string(),
            target: z.string(),
            native: z.string().optional(),
          }),
        ),
      })
      .optional(),
    translations: z.record(
      z.string(),
      z.union([
        z.object({
          text: z.string(),
          synonyms: z.array(z.object({ text: z.string() })),
        }),
        z.object({
          text: z.string(),
          expressionType: z.enum(["literal", "idiomatic_equivalent"]).optional().default("literal"),
          equivalentNote: z.string().optional(),
          usageNote: z.string().optional(),
          connotationWarning: z.string().optional(),
          synonyms: z.array(z.object({ text: z.string() })),
          examples: z.array(
            z.object({
              context: z.enum(["neutral", "colloquial", "professional"]),
              target: z.string(),
              native: z.string().optional(),
            }),
          ),
        }),
      ]),
    ),
  });

  it("skips example validation for the native target block when source is a learning language", () => {
    const raw = {
      emoji: "🫐",
      nativeMeaning: "Лесная ягода.",
      sourceUsage: {
        explanation: "Так называют лесную ягоду.",
        synonyms: [],
        examples: [],
      },
      translations: {
        ru: { text: "черника", synonyms: [] },
        en: {
          text: "blueberries",
          synonyms: [],
          examples: [{ context: "neutral", target: "I like blueberries.", native: "Я люблю чернику." }],
        },
      },
    };
    const result = validate(raw, minimalNativeSchema, "borůvky", ["ru", "en"], "word", {
      nativeLang: "ru",
      sourceLang: "cs",
    });
    expect(result.valid).toBe(true);
  });

  it("still validates examples for non-native targets when source is a learning language", () => {
    const raw = {
      emoji: "🫐",
      nativeMeaning: "Лесная ягода.",
      sourceUsage: {
        explanation: "Так называют лесную ягоду.",
        synonyms: [],
        examples: [],
      },
      translations: {
        ru: { text: "черника", synonyms: [] },
        en: {
          text: "blueberries",
          synonyms: [],
          examples: [{ context: "neutral", target: "Completely unrelated sentence" }],
        },
      },
    };
    const result = validate(raw, minimalNativeSchema, "borůvky", ["ru", "en"], "word", {
      nativeLang: "ru",
      sourceLang: "cs",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "examples")).toBe(true);
  });
});

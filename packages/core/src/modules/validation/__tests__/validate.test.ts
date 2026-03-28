import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validate } from "../index.js";

/** Minimal schema matching the BRD translation result structure */
const translationResultSchema = z.object({
  emoji: z.string(),
  register: z.enum(["slang", "colloquial", "neutral", "literary", "professional"]),
  translations: z.record(
    z.string(),
    z.object({
      text: z.string(),
      cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
      transcription: z.string().optional(),
      register: z.enum(["slang", "colloquial", "neutral", "literary", "professional"]),
      expressionType: z.enum(["literal", "idiomatic_equivalent"]).optional().default("literal"),
      equivalentNote: z.string().optional(),
      synonyms: z.array(
        z.object({
          text: z.string(),
          register: z.enum(["slang", "colloquial", "neutral", "literary", "professional"]),
        }),
      ),
      examples: z.array(
        z.object({
          context: z.enum(["formal", "colloquial", "professional"]),
          target: z.string(),
          native: z.string(),
        }),
      ),
    }),
  ),
});

function makeValidResponse(original: string) {
  return {
    emoji: "👋",
    register: "neutral" as const,
    translations: {
      cs: {
        text: "ahoj",
        cefr: "A1" as const,
        transcription: "[ˈahoj]",
        register: "colloquial" as const,
        synonyms: [{ text: "nazdar", register: "colloquial" as const }],
        examples: [
          {
            context: "formal" as const,
            target: "Řekl ahoj svému kolegovi při setkání v kanceláři.",
            native: `He said ${original} to his colleague at the office meeting.`,
          },
          {
            context: "colloquial" as const,
            target: "Ahoj, jak se máš dneska odpoledne kamaráde?",
            native: `${original}, how are you doing this afternoon?`,
          },
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
      register: "neutral",
      translations: {
        cs: {
          text: "hello", // same as original
          cefr: "A1",
          register: "neutral",
          synonyms: [],
          examples: [
            {
              context: "formal",
              target: "Hello there, how are you doing today?",
              native: "Ahoj, jak se máš dneska?",
            },
          ],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
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

  it("passes examples even when target does not contain the translated word", () => {
    const raw = {
      emoji: "👋",
      register: "neutral",
      translations: {
        cs: {
          text: "ahoj",
          cefr: "A1",
          register: "neutral",
          synonyms: [],
          examples: [
            {
              context: "formal",
              target: "Completely unrelated sentence without the word",
              native: "Zcela nesouvisející věta bez slova",
            },
          ],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(true);
    expect(result.errors.some((e) => e.rule === "examples")).toBe(false);
  });

  it("validates hallucination patterns", () => {
    const raw = {
      emoji: "👋",
      register: "neutral",
      translations: {
        cs: {
          text: "N/A",
          cefr: "A1",
          register: "neutral",
          synonyms: [],
          examples: [
            {
              context: "formal",
              target: "N/A in this sentence",
              native: "Some native text",
            },
          ],
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
      register: "neutral",
      translations: {
        cs: {
          text: "hello", // same as original
          cefr: "A1",
          register: "neutral",
          synonyms: [],
          examples: [
            {
              context: "formal",
              target: "Hello sentence for testing here today",
              native: "Testovací věta pro dnešek tady",
            },
          ],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "hello", ["cs"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.startsWith("translations.cs."))).toBe(true);
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "ahoj",
          cefr: "A1" as const,
          register: "colloquial" as const,
          synonyms: [{ text: "nazdar", register: "colloquial" as const }],
          examples: [
            {
              context: "formal" as const,
              target: "Řekl ahoj svému kolegovi při setkání v kanceláři.",
              native: "He said hello to his colleague at the office meeting.",
            },
          ],
        },
        de: {
          text: "hallo",
          cefr: "A1" as const,
          register: "neutral" as const,
          synonyms: [{ text: "guten Tag", register: "neutral" as const }],
          examples: [
            {
              context: "formal" as const,
              target: "Er sagte hallo zu seinem Kollegen bei dem Treffen.",
              native: "He said hello to his colleague at the meeting.",
            },
          ],
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
      register: "neutral" as const,
      translations: {
        de: {
          text: "hello", // same as original — semantic error
          cefr: "A1" as const,
          register: "neutral" as const,
          synonyms: [],
          examples: [
            {
              context: "formal" as const,
              target: "Er sagte hello zu seinem Kollegen im Büro heute.",
              native: "He said hello to his colleague at the office today.",
            },
          ],
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
      register: "neutral" as const,
      translations: {
        fr: {
          text: "I cannot translate this word",
          cefr: "B1" as const,
          register: "neutral" as const,
          synonyms: [],
          examples: [
            {
              context: "formal" as const,
              target: "Une phrase en français pour tester la validation.",
              native: "A sentence in French to test the validation.",
            },
          ],
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "ahoj",
          cefr: "A1" as const,
          register: "colloquial" as const,
          synonyms: [],
          examples: [
            {
              context: "formal" as const,
              target: "Řekl ahoj svému kolegovi při setkání v kanceláři.",
              native: "He said hello to his colleague at the office meeting.",
            },
          ],
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "ahoj",
          cefr: "A1" as const,
          register: "colloquial" as const,
          synonyms: [],
          examples: [
            {
              context: "formal" as const,
              target: "", // empty target — examples validation error
              native: "He said hello to his colleague.",
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
      register: "neutral" as const,
      translations: {
        cs: {
          // Longer Czech text so franc-min can reliably detect it as Czech
          text: "Vlk se nažral a koza zůstala celá, to je české přísloví o dosažení obojího",
          cefr: "B2" as const,
          register: "colloquial" as const,
          expressionType: "idiomatic_equivalent" as const,
          equivalentNote: "Closest Czech equivalent of the English idiom about having both options.",
          synonyms: [],
          examples: [
            {
              context: "colloquial" as const,
              target: "Podařilo se mu dosáhnout obou cílů současně, vlk se nažral a koza zůstala celá.",
              native: "He managed to achieve both goals at once, having his cake and eating it too.",
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "Ranní ptáče dál doskáče",
          cefr: "B1" as const,
          register: "neutral" as const,
          expressionType: "idiomatic_equivalent" as const,
          equivalentNote: "Czech equivalent proverb about the value of waking early.",
          synonyms: [],
          examples: [
            {
              context: "formal" as const,
              target: "Vstával brzy, a tak měl vždy náskok před ostatními.",
              native: "He woke up early and always had a head start over others.",
            },
          ],
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "Vlk se nažral a koza zůstala celá",
          cefr: "B2" as const,
          register: "colloquial" as const,
          expressionType: "idiomatic_equivalent" as const,
          equivalentNote: "Czech equivalent proverb.",
          synonyms: [],
          examples: [
            {
              context: "colloquial" as const,
              target: "", // empty target — should still fail
              native: "He had his cake and ate it too.",
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "ahoj",
          cefr: "A1" as const,
          register: "colloquial" as const,
          // no expressionType — should default to "literal" or undefined
          synonyms: [{ text: "nazdar", register: "colloquial" as const }],
          examples: [
            {
              context: "formal" as const,
              target: "Řekl ahoj svému kolegovi při setkání v kanceláři.",
              native: "He said hello to his colleague at the office meeting.",
            },
          ],
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "ahoj",
          cefr: "A1" as const,
          register: "colloquial" as const,
          synonyms: [{ text: "nazdar", register: "colloquial" as const }],
          examples: [
            {
              context: "formal" as const,
              target: "Řekl ahoj svému kolegovi při setkání v kanceláři.",
              native: "He said hello to his colleague at the office meeting.",
            },
          ],
          alternatives: [
            {
              text: "nazdar",
              register: "colloquial" as const,
              synonyms: [{ text: "čau", register: "colloquial" as const }],
            },
            {
              text: "dobrý den",
              register: "neutral" as const,
              synonyms: [{ text: "zdravím", register: "neutral" as const }],
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "ahoj",
          cefr: "A1" as const,
          register: "colloquial" as const,
          synonyms: [],
          examples: [
            {
              context: "formal" as const,
              target: "Řekl ahoj svému kolegovi při setkání v kanceláři.",
              native: "He said hello to his colleague at the office meeting.",
            },
          ],
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "ahoj",
          cefr: "A1" as const,
          register: "colloquial" as const,
          synonyms: [],
          examples: [
            {
              context: "formal" as const,
              target: "Řekl ahoj svému kolegovi při setkání v kanceláři.",
              native: "He said hello to his colleague at the office meeting.",
            },
          ],
          alternatives: [
            {
              text: "nazdar",
              register: "colloquial" as const,
              synonyms: [],
            },
            {
              text: "hello", // same as original — semantic error
              register: "neutral" as const,
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "ahoj",
          cefr: "A1" as const,
          register: "colloquial" as const,
          synonyms: [],
          examples: [
            {
              context: "formal" as const,
              target: "Řekl ahoj svému kolegovi při setkání v kanceláři.",
              native: "He said hello to his colleague at the office meeting.",
            },
          ],
          alternatives: [
            {
              text: "I cannot translate this",
              register: "neutral" as const,
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
      register: "neutral" as const,
      translations: {
        de: {
          text: "hallo",
          cefr: "A1" as const,
          register: "neutral" as const,
          synonyms: [],
          examples: [
            {
              context: "formal" as const,
              target: "Er sagte hallo zu seinem Kollegen im Büro heute.",
              native: "He said hello to his colleague at the office today.",
            },
          ],
          alternatives: [
            {
              text: "grüß Gott",
              register: "neutral" as const,
              synonyms: [],
            },
            {
              text: "hello", // same as original
              register: "neutral" as const,
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
  /** Minimal sentence schema — only text + cefr + register + transcription */
  const sentenceSchema = z.object({
    emoji: z.string(),
    register: z.enum(["slang", "colloquial", "neutral", "literary", "professional"]),
    translations: z.record(
      z.string(),
      z.object({
        text: z.string(),
        cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
        transcription: z.string().optional(),
        register: z.enum(["slang", "colloquial", "neutral", "literary", "professional"]),
        synonyms: z.array(z.unknown()).default([]),
        examples: z.array(z.unknown()).default([]),
      }),
    ),
  });

  it("skips semantic validation when inputType is 'sentence' — translation equals original passes", () => {
    const original = "Can you tell me where the nearest pharmacy is";
    const raw = {
      emoji: "💊",
      register: "neutral" as const,
      translations: {
        cs: {
          text: original, // same as original — would fail without sentence mode
          cefr: "B1" as const,
          register: "neutral" as const,
          transcription: "",
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = validate(raw, sentenceSchema, original, ["cs"], "sentence");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("skips semantic validation when inputType is 'sentence' — hallucination pattern passes", () => {
    const raw = {
      emoji: "💊",
      register: "neutral" as const,
      translations: {
        de: {
          text: "N/A", // hallucination pattern — would fail without sentence mode
          cefr: "A1" as const,
          register: "neutral" as const,
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = validate(raw, sentenceSchema, "Where is the pharmacy?", ["de"], "sentence");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "Kde je nejbližší lékárna?",
          cefr: "B1" as const,
          register: "neutral" as const,
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "Kde je nejbližší lékárna?",
          cefr: "B1" as const,
          register: "neutral" as const,
          synonyms: [],
          examples: [],
          alternatives: [
            {
              text: "Where is the pharmacy?", // same as original — would fail without sentence mode
              register: "neutral" as const,
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "hello", // same as original — should fail
          cefr: "A1" as const,
          register: "neutral" as const,
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "hello", // same as original — should fail
          cefr: "A1" as const,
          register: "neutral" as const,
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "good morning", // same as original — should fail
          cefr: "A1" as const,
          register: "neutral" as const,
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
      register: "neutral" as const,
      translations: {
        cs: {
          text: "Kde je nejbližší lékárna?",
          cefr: "B1" as const,
          register: "neutral" as const,
          transcription: "[ɡdɛ jɛ nɛjblɪʃiː leːkaːrna]",
          synonyms: [],
          examples: [],
        },
        de: {
          text: "Wo ist die nächste Apotheke?",
          cefr: "A2" as const,
          register: "neutral" as const,
          transcription: "[voː ɪst diː nɛːçstə apoˈteːkə]",
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
    register: z.enum(["slang", "colloquial", "neutral", "literary", "professional"]),
    translations: z.record(
      z.string(),
      z.object({
        text: z.string(),
        cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
        register: z.enum(["slang", "colloquial", "neutral", "literary", "professional"]),
        synonyms: z.array(z.object({ text: z.string(), register: z.enum(["slang", "colloquial", "neutral", "literary", "professional"]) })),
        examples: z.array(z.object({ context: z.string(), target: z.string(), native: z.string() })).default([]),
        expressionType: z.enum(["literal", "idiomatic_equivalent"]).optional().default("literal"),
        alternatives: z.array(z.object({ text: z.string(), register: z.enum(["slang", "colloquial", "neutral", "literary", "professional"]), synonyms: z.array(z.object({ text: z.string(), register: z.enum(["slang", "colloquial", "neutral", "literary", "professional"]) })) })).optional(),
      }),
    ),
  });

  it("skips example validation when includeExamples is false", () => {
    const raw = {
      emoji: "🐻",
      register: "neutral" as const,
      translations: {
        en: {
          text: "beast",
          cefr: "B1" as const,
          register: "colloquial" as const,
          synonyms: [{ text: "creature", register: "neutral" as const }],
          examples: [], // empty — config says no examples
        },
        cs: {
          text: "zvíře",
          cefr: "A2" as const,
          register: "neutral" as const,
          synonyms: [{ text: "bestie", register: "colloquial" as const }],
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
      register: "neutral" as const,
      translations: {
        en: {
          text: "beast",
          cefr: "B1" as const,
          register: "colloquial" as const,
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
      register: "neutral" as const,
      translations: {
        en: {
          text: "beast",
          cefr: "B1" as const,
          register: "colloquial" as const,
          synonyms: [],
          examples: [{ context: "colloquial", target: "What a beast!", native: "Ну и зверюга!" }],
          // alternatives with hallucinated text — should be ignored when disabled
          alternatives: [{ text: "зверюга", register: "neutral", synonyms: [] }],
        },
      },
    };
    const result = validate(raw, translationResultSchema, "зверюга", ["en"], undefined, { includeAlternatives: false });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("still validates alternatives when includeAlternatives is not set", () => {
    const raw = {
      emoji: "🐻",
      register: "neutral" as const,
      translations: {
        en: {
          text: "beast",
          cefr: "B1" as const,
          register: "colloquial" as const,
          synonyms: [],
          examples: [{ context: "colloquial", target: "What a beast!", native: "Ну и зверюга!" }],
          alternatives: [{ text: "зверюга", register: "neutral", synonyms: [] }], // same as original — should fail
        },
      },
    };
    const result = validate(raw, translationResultSchema, "зверюга", ["en"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic" && e.field?.includes("alternatives"))).toBe(true);
  });

  it("skips both examples and alternatives when both are disabled", () => {
    const raw = {
      emoji: "🐻",
      register: "neutral" as const,
      translations: {
        en: {
          text: "beast",
          cefr: "B1" as const,
          register: "colloquial" as const,
          synonyms: [],
          examples: [],
          alternatives: [{ text: "зверюга", register: "neutral", synonyms: [] }],
        },
      },
    };
    const result = validate(raw, noExamplesSchema, "зверюга", ["en"], undefined, { includeExamples: false, includeAlternatives: false });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("semantic validation still runs even when examples/alternatives are disabled", () => {
    const raw = {
      emoji: "🐻",
      register: "neutral" as const,
      translations: {
        en: {
          text: "зверюга", // same as original — semantic should catch this
          cefr: "B1" as const,
          register: "neutral" as const,
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = validate(raw, noExamplesSchema, "зверюга", ["en"], undefined, { includeExamples: false, includeAlternatives: false });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validate } from "../index.js";

/** Minimal schema matching the BRD translation result structure */
const translationResultSchema = z.object({
  emoji: z.string(),
  register: z.enum([
    "slang",
    "colloquial",
    "neutral",
    "literary",
    "professional",
  ]),
  translations: z.record(
    z.string(),
    z.object({
      text: z.string(),
      cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
      transcription: z.string().optional(),
      register: z.enum([
        "slang",
        "colloquial",
        "neutral",
        "literary",
        "professional",
      ]),
      synonyms: z.array(
        z.object({
          text: z.string(),
          register: z.enum([
            "slang",
            "colloquial",
            "neutral",
            "literary",
            "professional",
          ]),
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
    const result = validate(raw, translationResultSchema, "hello", [
      "cs",
      "en",
    ]);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.rule === "schema" && e.message.includes("Missing translation"),
      ),
    ).toBe(true);
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
    expect(
      result.errors.some((e) => e.field?.startsWith("translations.cs.")),
    ).toBe(true);
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

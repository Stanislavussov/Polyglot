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

  it("validates examples contain the translated word", () => {
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
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "examples")).toBe(true);
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

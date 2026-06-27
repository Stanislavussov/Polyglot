/**
 * Tests for template-aware rendering in renderTranslation().
 * Verifies that TemplateFields controls which sections appear in the card.
 */
import type { TemplateFields, TranslateOutput } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { renderTranslation } from "../renderers/translation.renderer.js";

// Mock getLangFlag from @polyglot/core
vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  const flagMap: Record<string, string> = {
    en: "🇬🇧",
    cs: "🇨🇿",
    de: "🇩🇪",
    ru: "🇷🇺",
  };
  return {
    ...actual,
    getLangFlag: vi.fn((code: string) => flagMap[code]),
  };
});

const sampleOutput: TranslateOutput = {
  original: "hello",
  sourceLang: "en",
  emoji: "👋",
  nativeSynonyms: [{ text: "привет" }],
  translations: {
    cs: {
      text: "ahoj",
      synonyms: [{ text: "dobrý den" }, { text: "nazdar" }],
      examples: [
        { context: "neutral", target: "Dobrý den, pane!" },
        { context: "colloquial", target: "Ahoj, jak se máš?" },
      ],
      alternatives: [
        {
          text: "zdravím",
          synonyms: [],
        },
      ],
      connotationWarning: "informal in professional settings",
    },
  },
};

/** All fields enabled (default behavior) */
const allTrue: TemplateFields = {
  synonyms: true,
  examples: true,
  alternatives: true,
  equivalentNote: true,
  connotationWarning: true,
};

/** All fields disabled */
const allFalse: TemplateFields = {
  synonyms: false,
  examples: false,
  alternatives: false,
  equivalentNote: false,
  connotationWarning: false,
};

describe("renderTranslation — template-aware (Task 32)", () => {
  it("renders all sections when templateFields is undefined (backward compat)", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("(dobrý den, nazdar)");
    expect(result).toContain("💬");
    expect(result).toContain("∙ zdravím");
    expect(result).toContain("ℹ️");
  });

  it("renders all sections when all fields are true", () => {
    const result = renderTranslation(sampleOutput, "en", allTrue);
    expect(result).toContain("(dobrý den, nazdar)");
    expect(result).toContain("💬");
    expect(result).toContain("∙ zdravím");
    expect(result).toContain("ℹ️");
  });

  it("renders translation text without transcription", () => {
    const result = renderTranslation(sampleOutput, "en", allTrue);
    expect(result).toContain("<b>ahoj</b>");
  });

  it("omits inline synonyms when synonyms is false", () => {
    const fields: TemplateFields = { ...allTrue, synonyms: false };
    const result = renderTranslation(sampleOutput, "en", fields);
    expect(result).not.toContain("(dobrý den, nazdar)");
    // Translation text is still shown
    expect(result).toContain("<b>ahoj</b>");
  });

  it("omits examples when examples is false", () => {
    const fields: TemplateFields = { ...allTrue, examples: false };
    const result = renderTranslation(sampleOutput, "en", fields);
    expect(result).not.toContain("💬");
    expect(result).not.toContain("Dobrý den, pane!");
  });

  it("omits alternatives when alternatives is false", () => {
    const fields: TemplateFields = { ...allTrue, alternatives: false };
    const result = renderTranslation(sampleOutput, "en", fields);
    expect(result).not.toContain("∙ zdravím");
  });

  it("omits connotation warning when connotationWarning is false", () => {
    const fields: TemplateFields = { ...allTrue, connotationWarning: false };
    const result = renderTranslation(sampleOutput, "en", fields);
    expect(result).not.toContain("ℹ️");
    expect(result).not.toContain("informal in professional settings");
  });

  it("renders only emoji, word, and bare translation when all fields false", () => {
    const result = renderTranslation(sampleOutput, "en", allFalse);
    expect(result).toContain("👋 🇬🇧 <b>hello</b>");
    expect(result).toContain("🇨🇿 CS: <b>ahoj</b>");
    // No optional sections
    expect(result).not.toContain("[ˈahoj]");
    expect(result).not.toContain("(dobrý den");
    expect(result).not.toContain("💬");
    expect(result).not.toContain("∙");
    expect(result).not.toContain("ℹ️");
  });

  it("still renders needsReview regardless of template fields", () => {
    const result = renderTranslation(sampleOutput, "en", allFalse, undefined, true);
    expect(result).toContain("inaccuracies");
  });

  it("allows mixing enabled and disabled fields", () => {
    const fields: TemplateFields = {
      synonyms: false,
      examples: true,
      alternatives: false,
      equivalentNote: true,
      connotationWarning: false,
    };
    const result = renderTranslation(sampleOutput, "en", fields);
    expect(result).not.toContain("(dobrý den");
    expect(result).toContain("💬");
    expect(result).not.toContain("∙ zdravím");
    expect(result).not.toContain("ℹ️");
  });
});

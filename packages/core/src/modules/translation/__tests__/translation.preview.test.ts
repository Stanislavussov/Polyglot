/**
 * Spec — progressive card (`TranslationHooks.onPreview`).
 *
 * 1. With an observer, translate() hands it the card as it settles: first the
 *    headword alone, then the metadata (emoji), then each language as it lands.
 * 2. The last preview's translations match the final output.
 * 3. A headword the existence guard sends back as a question never previews a
 *    card: only the bare headword goes out before the clarification.
 * 4. A throwing observer never affects the translation.
 * 5. Without an observer the decision is unchanged (covered by every other
 *    translate() test, which passes no hook).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../logger.js";
import { setLogger } from "../../../logger.js";
import { translate } from "../translation.service.js";
import type { LanguageTranslation, TranslateInput, TranslateOutput } from "../types.js";

const mockLogger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  setLogger(mockLogger);
});

const input: TranslateInput = {
  word: "dog",
  sourceLang: "en",
  targetLangs: ["cs", "de"],
  inputType: "word",
  model: "openai/gpt-4o",
  correctionPolicy: { assessSourceExistence: true },
};

function block(text: string, examples: string[]): LanguageTranslation {
  return {
    text,
    synonyms: [],
    examples: examples.map((target, i) => ({ context: ["neutral", "colloquial", "professional"][i], target })),
    expressionType: null,
    equivalentNote: null,
    usageNote: null,
    alternatives: null,
    connotationWarning: null,
  };
}

const CS = block("pes", ["Mám psa.", "Ten pes štěká.", "Pes hlídá dům."]);
const DE = block("Hund", ["Ich habe einen Hund.", "Der Hund bellt.", "Der Hund bewacht das Haus."]);

function createMock(recognized: boolean) {
  return vi.fn().mockImplementation(async (prompt: string) => {
    if (prompt.includes("preflight ambiguity checker")) {
      return { outcome: "proceed", confidence: 0.99, explanation: "", options: [], correctedText: null };
    }
    if (prompt.includes("translation quality judge")) return { issues: [], summary: "ok" };
    if (prompt.includes("Do NOT include any translations")) {
      return { emoji: "🐕", nativeSynonyms: [], sourceWordRecognized: recognized, suggestedCorrection: null };
    }
    if (prompt.includes('language "cs"')) return CS;
    if (prompt.includes('language "de"')) return DE;
    throw new Error(`unexpected prompt: ${prompt.slice(0, 80)}`);
  });
}

describe("translate() previews", () => {
  it("hands over the headword, then the metadata, then each language, ending on the final card", async () => {
    const previews: TranslateOutput[] = [];
    const decision = await translate(input, createMock(true), { onPreview: (p) => previews.push(structuredClone(p)) });

    expect(decision.status).not.toBe("needs_clarification");
    expect(previews.length).toBe(4);
    expect(previews[0]).toMatchObject({ original: "dog", translations: {} });
    expect(previews[0].emoji).toBeUndefined();
    expect(previews[1]).toMatchObject({ emoji: "🐕", translations: {} });
    expect(Object.keys(previews[2].translations)).toHaveLength(1);
    const last = previews[3];
    expect(Object.keys(last.translations).sort()).toEqual(["cs", "de"]);
    if (decision.status === "needs_clarification") return;
    expect(last.translations.cs.text).toBe(decision.output.translations.cs.text);
    expect(last.translations.de.text).toBe(decision.output.translations.de.text);
  });

  it("previews no card for a headword the guard turns into a question", async () => {
    const previews: TranslateOutput[] = [];
    const decision = await translate(input, createMock(false), { onPreview: (p) => previews.push(structuredClone(p)) });

    expect(decision.status).toBe("needs_clarification");
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) {
      expect(preview.translations).toEqual({});
      expect(preview.emoji).toBeUndefined();
    }
  });

  it("ignores an observer that throws", async () => {
    const decision = await translate(input, createMock(true), {
      onPreview: () => {
        throw new Error("boom");
      },
    });

    expect(decision.status).not.toBe("needs_clarification");
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { initLanguageRegistry } from "../i18n/language-registry.js";
import { EXPRESSION_CATEGORIES, expressionSeed, pickExpressionAngle } from "./expression-angle.js";
import { buildExpressionPrompt, MAX_AVOIDED_EXPRESSIONS } from "./expression-prompt.js";
import { expressionSchema } from "./expression-schema.js";

describe("expressionSeed", () => {
  const day = new Date("2026-11-01T10:00:00Z");

  it("is stable for the same user, day and hour", () => {
    expect(expressionSeed(7, day, 19)).toBe(expressionSeed(7, new Date("2026-11-01T22:00:00Z"), 19));
  });

  it("changes with the day, the hour and the user", () => {
    const base = expressionSeed(7, day, 19);
    expect(expressionSeed(7, new Date("2026-11-02T10:00:00Z"), 19)).not.toBe(base);
    expect(expressionSeed(7, day, 9)).not.toBe(base);
    expect(expressionSeed(8, day, 19)).not.toBe(base);
  });
});

describe("pickExpressionAngle", () => {
  it("is deterministic for a seed", () => {
    expect(pickExpressionAngle(12345, ["ru", "en"])).toEqual(pickExpressionAngle(12345, ["ru", "en"]));
  });

  it("covers several categories and every language over a week of slots", () => {
    const langs = ["ru", "en", "de"];
    const angles = Array.from({ length: 21 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 10, 1 + Math.floor(i / 3)));
      const hour = [9, 14, 19][i % 3] ?? 9;
      return pickExpressionAngle(expressionSeed(42, day, hour), langs);
    });
    expect(new Set(angles.map((a) => a.category)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(angles.map((a) => a.lang))).toEqual(new Set(langs));
    for (const angle of angles) expect(EXPRESSION_CATEGORIES).toContain(angle.category);
  });

  it("falls back to English when no language is given", () => {
    expect(pickExpressionAngle(1, []).lang).toBe("en");
  });
});

describe("buildExpressionPrompt", () => {
  initLanguageRegistry([
    { code: "ru", name: "Russian", isSupported: true },
    { code: "en", name: "English", isSupported: true },
  ]);
  const angle = { lang: "en", category: "a line from a film", theme: "courage", tone: "playful" };

  it("names the languages, the angle and asks for a translation when the language is not native", () => {
    const prompt = buildExpressionPrompt({ angle, nativeLang: "ru", avoid: [] });
    expect(prompt).toContain("in English");
    expect(prompt).toContain("Russian");
    expect(prompt).toContain("a line from a film");
    expect(prompt).toContain("courage");
    expect(prompt).toContain("playful");
    expect(prompt).toContain('"translation"');
  });

  it("does not ask for a translation when the expression is in the native language", () => {
    const prompt = buildExpressionPrompt({ angle: { ...angle, lang: "ru" }, nativeLang: "ru", avoid: [] });
    expect(prompt).not.toContain('"translation"');
  });

  it("lists recent expressions to avoid, capped", () => {
    const avoid = Array.from({ length: 40 }, (_, i) => `phrase-${i}`);
    const prompt = buildExpressionPrompt({ angle, nativeLang: "ru", avoid });
    expect(prompt).toContain("phrase-0");
    expect(prompt).toContain(`phrase-${MAX_AVOIDED_EXPRESSIONS - 1}`);
    expect(prompt).not.toContain(`phrase-${MAX_AVOIDED_EXPRESSIONS}"`);
  });

  it("omits the avoid block when there is nothing to avoid", () => {
    expect(buildExpressionPrompt({ angle, nativeLang: "ru", avoid: [] })).not.toMatch(/do not repeat/i);
  });
});

describe("expressionSchema", () => {
  it("accepts a full expression and one without translation or title", () => {
    const full = {
      expression: "Be a goldfish",
      meaning: "Быстро забудь неудачу",
      translation: "Будь золотой рыбкой",
      sourceKind: "series",
      sourceTitle: "Ted Lasso",
      example: "Missed the penalty? Be a goldfish.",
    };
    expect(expressionSchema.parse(full)).toEqual(full);
    const { translation: _t, sourceTitle: _s, ...minimal } = full;
    expect(expressionSchema.parse({ ...minimal, sourceKind: "folk" })).toMatchObject({ sourceKind: "folk" });
  });

  it("accepts null for the optional fields, as strict-mode models send them", () => {
    const parsed = expressionSchema.parse({
      expression: "Carpe diem",
      meaning: "Лови момент",
      translation: null,
      sourceKind: "history",
      sourceTitle: null,
      example: "Carpe diem — let's go tonight.",
    });
    expect(parsed.translation).toBeNull();
    expect(parsed.sourceTitle).toBeNull();
  });

  it("rejects an unknown source kind", () => {
    expect(() =>
      expressionSchema.parse({ expression: "x", meaning: "y", sourceKind: "podcast", example: "z" }),
    ).toThrow();
  });
});

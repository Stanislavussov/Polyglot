import { describe, expect, it } from "vitest";
import { validateExamples } from "../validators/example.validator.js";

/**
 * Spec — headword coverage across examples.
 *
 * Observed defect (RU "какать кирпичами" → en/cs): the card taught one expression
 * but illustrated it with three different ones. Only `examples[0]` was ever checked,
 * and for `expressionType: "idiomatic_equivalent"` the check was skipped entirely,
 * so an idiom card had zero example validation.
 *
 * Behaviour under test:
 * - For a multi-word translation, at least half the examples must demonstrate it.
 * - Idiomatic equivalents are covered too — no blanket skip.
 * - Single-word translations keep the pre-existing first-example rule, because the
 *   stem matcher is not reliable enough below two tokens to judge every example.
 * - Matching stays lenient (one significant token, stem-matched) so inflection and
 *   dropped function words do not fail a good translation.
 */

const CTX = "neutral" as const;

describe("validateExamples — headword coverage", () => {
  it("flags an idiom illustrated mostly by synonyms (the observed EN defect)", () => {
    const result = validateExamples(
      [
        { context: CTX, target: "I was shitting bricks when I saw the police car behind me." },
        { context: CTX, target: "He was scared stiff before his final exam." },
        { context: CTX, target: "We were petrified during the turbulence on the flight." },
      ],
      "to shit bricks",
      "idiomatic_equivalent",
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "examples")).toBe(true);
  });

  it("flags a calqued headword whose examples use the real idiom (the observed CS defect)", () => {
    // Verbatim from the reported output: "kadit cihly" is a word-for-word calque, while
    // the model's own examples 2 and 3 fall back to genuine Czech idioms.
    const result = validateExamples(
      [
        { context: CTX, target: "Když uviděl tu policii, začal kadit cihly." },
        { context: CTX, target: "Byl z toho tak podělaný, že se ani nepohnul." },
        { context: CTX, target: "Před tou zkouškou měl hrozně nahnáno." },
      ],
      "kadit cihly",
      "idiomatic_equivalent",
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "examples.1.target")).toBe(true);
  });

  it("leaves single-word translations to the first-example rule", () => {
    // Coverage across all examples is confined to multi-word translations: `sameStem`
    // needs an exact match below 5 chars, so demanding it of every example rejects
    // correct output for German separable verbs, short Slavic verbs, and Kazakh
    // infinitives. Here only the first example uses "спать" and that is fine.
    const result = validateExamples(
      [
        { context: CTX, target: "Я люблю спать долго." },
        { context: CTX, target: "Он спит весь день." },
        { context: CTX, target: "Мы спали до утра." },
      ],
      "спать",
    );

    expect(result.valid).toBe(true);
  });

  it("accepts an idiom demonstrated by a majority of examples", () => {
    const result = validateExamples(
      [
        { context: CTX, target: "You can't have your cake and eat it too." },
        { context: CTX, target: "She wanted to have her cake and eat it too." },
        { context: CTX, target: "That is simply not possible here." },
      ],
      "have your cake and eat it too",
      "idiomatic_equivalent",
    );

    expect(result.valid).toBe(true);
  });

  it("tolerates inflection and dropped function words", () => {
    // Regression guard for the over-strict era: requiring every token verbatim
    // rejected correct output. One stem-matched significant token is enough.
    const result = validateExamples(
      [
        { context: CTX, target: "Er hat was auf dem Kasten." },
        { context: CTX, target: "Sie hatte wirklich was auf dem Kasten." },
      ],
      "etwas auf dem Kasten haben",
      "idiomatic_equivalent",
    );

    expect(result.valid).toBe(true);
  });

  it("does not run the coverage check when the translation has no significant token", () => {
    const result = validateExamples([{ context: CTX, target: "Ich bin da." }], "ok");

    expect(result.valid).toBe(true);
  });
});

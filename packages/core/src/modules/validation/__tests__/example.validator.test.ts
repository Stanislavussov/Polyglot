import { describe, expect, it } from "vitest";
import { validateExamples, validateSourceUsageExamples } from "../validators/example.validator.js";

describe("validateExamples", () => {
  it("returns valid for well-formed examples", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Hippokratova přísaha obsahuje důležitá slova.",
        },
      ],
      "slova",
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when no examples provided", () => {
    const result = validateExamples([], "hello");
    expect(result.valid).toBe(false);
    expect(result.errors[0].rule).toBe("examples");
    expect(result.errors[0].message).toContain("No examples");
  });

  it("fails for empty target text", () => {
    const result = validateExamples([{ context: "neutral", target: "" }], "word");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("target"))).toBe(true);
  });

  it("fails for empty target text", () => {
    const result = validateExamples([{ context: "neutral", target: "" }], "ahoj");
    expect(result.valid).toBe(false);
    expect(result.errors[0].rule).toBe("examples");
  });

  it("accepts any context value", () => {
    const result = validateExamples(
      [{ context: "any-context", target: "Ahoj, Hippokratova přísaha obsahuje důležitá slova." }],
      "ahoj",
    );
    expect(result.valid).toBe(true);
  });

  it("accepts all valid context values", () => {
    const contexts = ["neutral", "colloquial", "professional"] as const;
    for (const context of contexts) {
      const result = validateExamples([{ context, target: "Some word in target text." }], "word");
      expect(result.valid).toBe(true);
    }
  });

  it("fails when a simple literal first example does not contain the main translation", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Completely unrelated sentence here.",
        },
      ],
      "ahoj",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "examples.0.target")).toBe(true);
  });

  it("rejects an unrelated first example for a non-ASCII main translation", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Completely unrelated sentence here.",
        },
      ],
      "chlebíček",
    );
    expect(result.valid).toBe(false);
  });

  it("validates a multi-word main translation", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Vláda chce omezit používání plastů.",
        },
      ],
      "postupně ukončit",
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.field === "examples.0.target")).toBe(true);
  });

  it("accepts normal Czech inflection of a multi-word main translation", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Firma postupně ukončila výrobu starého modelu.",
        },
      ],
      "postupně ukončit",
    );

    expect(result.valid).toBe(true);
  });

  it("accepts normal Russian inflection of a multi-word main translation", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Компания постепенно откажется от устаревшей системы.",
        },
      ],
      "постепенно отказаться",
    );

    expect(result.valid).toBe(true);
  });

  it("validates multiple examples and reports all errors", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Good example with word hello",
        },
        {
          context: "colloquial",
          target: "",
        },
      ],
      "hello",
    );
    expect(result.valid).toBe(false);
    // Empty target for example 1
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("includes field path with example index", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "",
        },
      ],
      "specific_word",
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toMatch(/examples\.0/);
  });

  // Relaxed first-example rule: the example only needs to SHARE one significant
  // token of the translation (head content word), not repeat every token. These
  // encode the production false-rejects that drove ~36% of translations to
  // needs_review (annotated German nouns whose example changes the article, and
  // multi-word idioms whose example drops particles).
  describe("shares-a-significant-token (not every token)", () => {
    it("accepts an annotated German noun whose example uses a different article/case", () => {
      // "der Spott, -e" — a correct example uses accusative "den Spott"; the
      // article "der" is absent but the head noun "Spott" is present.
      const result = validateExamples(
        [{ context: "neutral", target: "Sein Kommentar war voller Spott gegen die Regierung." }],
        "der Spott, -e",
      );
      expect(result.valid).toBe(true);
    });

    it("accepts an annotated German noun phrase demonstrated by its head noun", () => {
      const result = validateExamples(
        [{ context: "neutral", target: "Eine flache Hierarchie fördert schnelle Entscheidungen." }],
        "die flache Hierarchie, -n",
      );
      expect(result.valid).toBe(true);
    });

    it("accepts a multi-word idiom whose example drops particles but keeps the head", () => {
      // "etwas auf dem Kasten haben" — example says "was auf dem Kasten" (etwas→was,
      // haben conjugated away) but keeps "Kasten".
      const result = validateExamples(
        [{ context: "neutral", target: "Sie hat wirklich was auf dem Kasten." }],
        "etwas auf dem Kasten haben",
      );
      expect(result.valid).toBe(true);
    });

    it("still rejects a first example that shares no token with the translation", () => {
      const result = validateExamples(
        [{ context: "neutral", target: "Vláda chce omezit používání plastů." }],
        "postupně ukončit",
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "examples.0.target")).toBe(true);
    });
  });
});

describe("validateSourceUsageExamples", () => {
  it("accepts full source-language sentences that use the headword", () => {
    const result = validateSourceUsageExamples(
      [
        { context: "neutral", target: "The weather was cold; nevertheless, we went for a walk.", native: "…" },
        {
          context: "formal",
          target: "The results were disappointing; nevertheless, the team pressed on.",
          native: "…",
        },
      ],
      "nevertheless",
    );
    expect(result.valid).toBe(true);
  });

  it("rejects an example whose target is just the bare headword (the collapsed-example bug)", () => {
    const result = validateSourceUsageExamples(
      [{ context: "neutral", target: "nevertheless", native: "Тем не менее…" }],
      "nevertheless",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.field === "sourceUsage.examples.0.target")).toBe(true);
  });

  it("rejects the headword echoed with only punctuation and no other words", () => {
    const result = validateSourceUsageExamples(
      [{ context: "neutral", target: "nevertheless.", native: "…" }],
      "nevertheless",
    );
    expect(result.valid).toBe(false);
  });

  it("accepts an inflected multi-word headword when the sentence adds real content", () => {
    const result = validateSourceUsageExamples(
      [{ context: "neutral", target: "Break a leg tonight at the show!", native: "…" }],
      "break a leg",
    );
    expect(result.valid).toBe(true);
  });
});

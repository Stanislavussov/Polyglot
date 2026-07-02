import { describe, expect, it } from "vitest";
import { PREFLIGHT_EXPLANATION_MAX, preflightResultSchema } from "../preflight.schema.js";

const base = {
  confidence: 0.6,
  reasonCode: "probable_typo" as const,
  explanation: "fixed a typo",
  options: [],
};

describe("preflightResultSchema", () => {
  it("accepts the new proceed_with_correction outcome with correctedText", () => {
    const parsed = preflightResultSchema.parse({
      ...base,
      outcome: "proceed_with_correction",
      correctedText: "hello",
    });
    expect(parsed.outcome).toBe("proceed_with_correction");
    expect(parsed.correctedText).toBe("hello");
  });

  it("rejects proceed_with_correction without correctedText", () => {
    const result = preflightResultSchema.safeParse({
      ...base,
      outcome: "proceed_with_correction",
    });
    expect(result.success).toBe(false);
  });

  it("allows proceed without correctedText", () => {
    const result = preflightResultSchema.safeParse({
      ...base,
      outcome: "proceed",
    });
    expect(result.success).toBe(true);
  });

  it("caps explanation length", () => {
    const result = preflightResultSchema.safeParse({
      ...base,
      outcome: "proceed",
      explanation: "x".repeat(PREFLIGHT_EXPLANATION_MAX + 1),
    });
    expect(result.success).toBe(false);
  });
});

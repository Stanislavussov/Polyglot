import { describe, expect, it } from "vitest";
import { semanticJudgeSchema } from "../quality.schema.js";

describe("semanticJudgeSchema", () => {
  it("accepts nullable repair instructions for OpenAI-compatible structured output", () => {
    const result = semanticJudgeSchema.parse({
      issues: [
        {
          fieldPath: "translations.cs.text",
          severity: "warning",
          message: "The wording is slightly unnatural.",
          repairInstruction: null,
        },
      ],
      summary: null,
    });

    expect(result.issues[0]?.repairInstruction).toBeNull();
    expect(result.summary).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { parseCliOptions } from "./cli.js";

describe("parseCliOptions", () => {
  it("prefers explicit CLI values", () => {
    const options = parseCliOptions(["--model", "openai/test-model", "--output", "./custom-report.json"], {
      AI_MODEL: "env/model",
    });

    expect(options.model).toBe("openai/test-model");
    expect(options.outputPath).toMatch(/custom-report\.json$/);
  });

  it("requires a model", () => {
    expect(() => parseCliOptions([], {})).toThrow(
      "Model is required. Pass --model <openrouter-model-id> or set AI_MODEL.",
    );
  });
});

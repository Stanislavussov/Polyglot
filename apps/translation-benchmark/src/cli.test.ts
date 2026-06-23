import { describe, expect, it } from "vitest";
import { parseCliOptions } from "./cli.js";

describe("parseCliOptions", () => {
  it("prefers explicit CLI values", () => {
    const options = parseCliOptions(["--model", "openai/test-model", "--output", "./custom-report.json"], {
      AI_MODEL: "env/model",
    });

    expect(options.group).toBe("all");
    expect(options.model).toBe("openai/test-model");
    expect(options.outputPath).toMatch(/custom-report\.json$/);
  });

  it("parses the smoke group", () => {
    const options = parseCliOptions(["--model", "openai/test-model", "--group", "smoke"], {});

    expect(options.group).toBe("smoke");
  });

  it("rejects an unknown group", () => {
    expect(() => parseCliOptions(["--model", "openai/test-model", "--group", "quick"], {})).toThrow(
      'Unknown benchmark group "quick". Use "all" or "smoke".',
    );
  });

  it("requires a model", () => {
    expect(() => parseCliOptions([], {})).toThrow(
      "Model is required. Pass --model <openrouter-model-id> or set AI_MODEL.",
    );
  });

  it("uses a Markdown report under docs by default", () => {
    const options = parseCliOptions(["--model", "openai/test-model"], {});

    expect(options.outputPath).toMatch(/docs\/translation-benchmarks\/translation-benchmark-.*\.md$/);
  });
});

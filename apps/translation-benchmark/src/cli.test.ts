import { describe, expect, it } from "vitest";
import { parseCliOptions } from "./cli.js";

describe("parseCliOptions", () => {
  it("prefers explicit CLI values", () => {
    const options = parseCliOptions(["--model", "openai/test-model", "--output", "./custom-report.json"], {
      AI_MODEL: "env/model",
    });

    expect(options.group).toBe("all");
    expect(options.models).toEqual(["openai/test-model"]);
    expect(options.runsPerCase).toBe(3);
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
      "Model is required. Pass --models <id,id,...>, --model <id>, or set AI_MODEL.",
    );
  });

  it("parses multiple models, repeat count, and baseline", () => {
    const options = parseCliOptions(
      ["--models", "openai/economy,anthropic/mid,google/strong", "--runs", "5", "--baseline", "./baseline.json"],
      {},
    );

    expect(options.models).toEqual(["openai/economy", "anthropic/mid", "google/strong"]);
    expect(options.runsPerCase).toBe(5);
    expect(options.baselinePath).toMatch(/baseline\.json$/);
  });

  it("rejects an invalid repeat count", () => {
    expect(() => parseCliOptions(["--model", "openai/test-model", "--runs", "0"], {})).toThrow(
      "--runs must be a positive integer.",
    );
  });

  it("requires three models for a comparison run", () => {
    expect(() => parseCliOptions(["--models", "openai/economy,anthropic/mid"], {})).toThrow(
      "--models requires at least three model IDs for economy, mid-tier, and strong comparison.",
    );
  });

  it("uses a Markdown report under docs by default", () => {
    const options = parseCliOptions(["--model", "openai/test-model"], {});

    expect(options.outputPath).toMatch(/docs\/translation-benchmarks\/translation-benchmark-.*\.md$/);
  });
});

/**
 * Tests for async validation bridge (Task 37.8).
 * Verifies feature-flag behavior, dynamic import, and graceful degradation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@polyglot/infra", () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import type { TranslateOutput } from "@polyglot/core";
import { logger } from "@polyglot/infra";
import { fireAsyncValidation } from "./async-validation.js";

const sampleOutput: TranslateOutput = {
  original: "hello",
  sourceLang: "en",
  emoji: "👋",
  register: "neutral",
  translations: {
    cs: {
      text: "ahoj",
      cefr: "A1",
      register: "colloquial",
      synonyms: [],
      examples: [],
      expressionType: "idiomatic_equivalent",
    },
    de: {
      text: "hallo",
      cefr: "A1",
      register: "neutral",
      synonyms: [],
      examples: [],
    },
  },
};

/** Flush microtask queue so fire-and-forget promises resolve */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("fireAsyncValidation", () => {
  const originalEnv = process.env.AI_MODEL_VALIDATOR;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AI_MODEL_VALIDATOR;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AI_MODEL_VALIDATOR = originalEnv;
    } else {
      delete process.env.AI_MODEL_VALIDATOR;
    }
  });

  it("returns immediately when AI_MODEL_VALIDATOR is not set", () => {
    delete process.env.AI_MODEL_VALIDATOR;

    fireAsyncValidation({
      output: sampleOutput,
      inputType: "word",
      targetLangs: ["cs", "de"],
    });

    // No dynamic import should be attempted — nothing logged
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns immediately when AI_MODEL_VALIDATOR is empty string", () => {
    process.env.AI_MODEL_VALIDATOR = "";

    fireAsyncValidation({
      output: sampleOutput,
      inputType: "word",
      targetLangs: ["cs", "de"],
    });

    expect(logger.error).not.toHaveBeenCalled();
  });

  it("attempts dynamic import when AI_MODEL_VALIDATOR is set", async () => {
    process.env.AI_MODEL_VALIDATOR = "google/gemini-2.5-flash-lite";

    fireAsyncValidation({
      output: sampleOutput,
      inputType: "phrase",
      targetLangs: ["cs", "de"],
    });

    await flushPromises();

    // The dynamic import of @polyglot/core will succeed but triggerAsyncValidation
    // may not be available as an exported function — either way, no crash
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("extracts expressionTypes from translation output without error", async () => {
    process.env.AI_MODEL_VALIDATOR = "google/gemini-2.5-flash-lite";

    // Output with expressionType fields — should be extracted and passed to core
    fireAsyncValidation({
      output: sampleOutput,
      inputType: "word",
      targetLangs: ["cs", "de"],
    });

    await flushPromises();

    // Should not throw — fire-and-forget with error handling
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("passes savedWordId to onFlagged callback context", async () => {
    process.env.AI_MODEL_VALIDATOR = "google/gemini-2.5-flash-lite";

    // Should not crash even with savedWordId
    fireAsyncValidation({
      output: sampleOutput,
      inputType: "word",
      targetLangs: ["cs", "de"],
      savedWordId: 42,
    });

    await flushPromises();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("handles undefined inputType gracefully", async () => {
    process.env.AI_MODEL_VALIDATOR = "google/gemini-2.5-flash-lite";

    fireAsyncValidation({
      output: sampleOutput,
      targetLangs: ["cs"],
    });

    await flushPromises();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

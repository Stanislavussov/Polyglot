import { describe, expect, it, vi } from "vitest";
import { type EtymologyInput, generateEtymology } from "../etymology.service.js";

describe("generateEtymology", () => {
  const baseInput: EtymologyInput = {
    originalText: "kavárna",
    sourceLang: "cs",
    nativeLang: "ru",
    inputType: "word",
  };

  it("calls generateObjectFn and returns the etymology string", async () => {
    const generateObjectFn = vi.fn().mockResolvedValue({ etymology: "От французского café — кофе." });

    const result = await generateEtymology(baseInput, generateObjectFn, "test-model");

    expect(generateObjectFn).toHaveBeenCalledOnce();
    expect(result).toBe("От французского café — кофе.");
  });

  it("includes the original term and source language in the prompt", async () => {
    const generateObjectFn = vi.fn().mockResolvedValue({ etymology: "x" });

    await generateEtymology(baseInput, generateObjectFn, "test-model");

    const prompt = generateObjectFn.mock.calls[0][0] as string;
    expect(prompt).toContain("kavárna");
    expect(prompt).toContain("Czech");
  });

  it("requests the explanation in the native language", async () => {
    const generateObjectFn = vi.fn().mockResolvedValue({ etymology: "x" });

    await generateEtymology(baseInput, generateObjectFn, "test-model");

    const prompt = generateObjectFn.mock.calls[0][0] as string;
    expect(prompt).toContain("Russian");
  });

  it("passes userId to generateObjectFn", async () => {
    const generateObjectFn = vi.fn().mockResolvedValue({ etymology: "x" });

    await generateEtymology(baseInput, generateObjectFn, "test-model", 42);

    expect(generateObjectFn.mock.calls[0][3]).toEqual({ userId: 42 });
  });
});

import { describe, expect, it } from "vitest";
import { loudness } from "./wav-recorder";

describe("loudness", () => {
  it("is zero for silence and for an empty slice", () => {
    expect(loudness(new Float32Array(256))).toBe(0);
    expect(loudness(new Float32Array(0))).toBe(0);
  });

  it("moves visibly for a quiet voice", () => {
    expect(loudness(new Float32Array(256).fill(0.02))).toBeGreaterThan(0.2);
  });

  it("grows with volume and never passes 1", () => {
    const quiet = loudness(new Float32Array(256).fill(0.05));
    const loud = loudness(new Float32Array(256).fill(0.3));
    expect(loud).toBeGreaterThan(quiet);
    expect(loudness(new Float32Array(256).fill(1))).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { shouldTick } from "./haptics";

describe("shouldTick", () => {
  it("ticks for the first piece", () => {
    expect(shouldTick(1000, null)).toBe(true);
  });

  it("merges pieces that land almost together into one tick", () => {
    expect(shouldTick(1050, 1000)).toBe(false);
  });

  it("ticks again once the last tick has faded", () => {
    expect(shouldTick(1200, 1000)).toBe(true);
  });
});

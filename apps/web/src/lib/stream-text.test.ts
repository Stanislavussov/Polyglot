import { describe, expect, it } from "vitest";
import { charsPerFrame, sharedPrefix } from "./stream-text";

describe("sharedPrefix", () => {
  it("is zero for a fresh text", () => {
    expect(sharedPrefix("", "hello")).toBe(0);
  });

  it("keeps what the new text continues", () => {
    expect(sharedPrefix("Я рад", "Я рад тебя видеть")).toBe(5);
  });

  it("stops at the first changed character", () => {
    expect(sharedPrefix("happy day", "happy days ahead")).toBe(9);
    expect(sharedPrefix("cat", "car")).toBe(2);
  });
});

describe("charsPerFrame", () => {
  it("types short text at a readable pace", () => {
    expect(charsPerFrame(10)).toBe(2);
  });

  it("speeds up so a long text never takes more than about 40 frames", () => {
    expect(Math.ceil(400 / charsPerFrame(400))).toBeLessThanOrEqual(40);
  });
});

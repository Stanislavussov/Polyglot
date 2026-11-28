/**
 * Spec — a headword and its speaker button share one line.
 *
 * 1. The last word travels with the button: everything before it may wrap, the last word never
 *    leaves the button's line.
 * 2. When the last word and the button do not fit even a whole line, the headline shrinks just
 *    enough to fit, down to a floor; past the floor the word may break instead of shrinking further.
 */
import { describe, expect, it } from "vitest";
import { HEADLINE_MIN_SCALE, headlineScale, splitLastWord } from "./headline-fit";

describe("splitLastWord", () => {
  it("keeps a single word whole", () => {
    expect(splitLastWord("Contemplate")).toEqual({ lead: "", tail: "Contemplate" });
  });

  it("splits a phrase before its last word, keeping the space with the lead", () => {
    expect(splitLastWord("take it easy")).toEqual({ lead: "take it ", tail: "easy" });
  });

  it("ignores trailing spaces", () => {
    expect(splitLastWord("look up  ")).toEqual({ lead: "look ", tail: "up" });
  });
});

describe("headlineScale", () => {
  it("keeps the size when the word fits", () => {
    expect(headlineScale(150, 140)).toBe(1);
  });

  it("shrinks just enough for an overflowing word", () => {
    const scale = headlineScale(148, 175);
    expect(scale).not.toBeNull();
    expect(scale! * 175).toBeLessThanOrEqual(148);
    expect(scale).toBeGreaterThan(0.8);
  });

  it("gives up shrinking below the floor so a very long word can break", () => {
    expect(headlineScale(100, 100 / HEADLINE_MIN_SCALE + 50)).toBeNull();
  });

  it("does nothing before layout has a width", () => {
    expect(headlineScale(0, 0)).toBe(1);
  });
});

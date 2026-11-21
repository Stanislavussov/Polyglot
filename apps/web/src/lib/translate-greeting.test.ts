import { describe, expect, it } from "vitest";
import { greetingsFor, pickGreeting } from "./translate-greeting";

describe("greetingsFor", () => {
  it("adds morning phrases in the morning and the moonlit one only at night", () => {
    expect(greetingsFor(8)).toContain("web.translate.greet.coffee");
    expect(greetingsFor(8)).not.toContain("web.translate.greet.moonlit");
    expect(greetingsFor(2)).toContain("web.translate.greet.moonlit");
    expect(greetingsFor(23)).toContain("web.translate.greet.moonlit");
    expect(greetingsFor(20)).toContain("web.translate.greet.beforeBed");
  });

  it("offers the anytime phrases at every hour", () => {
    for (let hour = 0; hour < 24; hour++) expect(greetingsFor(hour)).toContain("web.translate.greet.what");
  });
});

describe("pickGreeting", () => {
  it("covers every option across the random range and never runs past the end", () => {
    const options = greetingsFor(14);
    expect(pickGreeting(14, 0)).toBe(options[0]);
    expect(pickGreeting(14, 0.9999)).toBe(options[options.length - 1]);
  });
});

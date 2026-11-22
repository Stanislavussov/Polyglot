import { describe, expect, it } from "vitest";
import { hidesDock, isTextEntry, QUICK_TARGETS, quickTargetFor } from "./mobile-dock";

describe("quick buttons", () => {
  it("offers translate, dictionary, review and the mentor, in that order", () => {
    expect(QUICK_TARGETS).toEqual(["translate", "dictionary", "review", "mentor"]);
  });

  it("lights the button of the page the learner is on", () => {
    expect(quickTargetFor("translate")).toBe("translate");
    expect(quickTargetFor("review")).toBe("review");
    expect(quickTargetFor("mentor")).toBe("mentor");
  });

  it("keeps the dictionary lit while asking about one of its words", () => {
    expect(quickTargetFor("ask")).toBe("dictionary");
  });

  it("lights nothing on other pages", () => {
    expect(quickTargetFor("settings")).toBeNull();
    expect(quickTargetFor("grammar")).toBeNull();
  });
});

describe("isTextEntry", () => {
  it("counts text boxes and editable areas as typing", () => {
    expect(isTextEntry("TEXTAREA", "text", false)).toBe(true);
    expect(isTextEntry("INPUT", "text", false)).toBe(true);
    expect(isTextEntry("INPUT", "search", false)).toBe(true);
    expect(isTextEntry("DIV", "text", true)).toBe(true);
  });

  it("leaves buttons, checkboxes and sliders out: they raise no keyboard", () => {
    expect(isTextEntry("INPUT", "checkbox", false)).toBe(false);
    expect(isTextEntry("INPUT", "range", false)).toBe(false);
    expect(isTextEntry("BUTTON", "submit", false)).toBe(false);
  });
});

describe("hidesDock", () => {
  it("hides the panel when the learner taps into a text field", () => {
    expect(hidesDock(true, 120)).toBe(true);
  });

  it("keeps the panel when the page focuses a field on its own: no tap, so no keyboard on a phone", () => {
    expect(hidesDock(true, Number.POSITIVE_INFINITY)).toBe(false);
    expect(hidesDock(true, 5000)).toBe(false);
  });

  it("keeps the panel outside text fields", () => {
    expect(hidesDock(false, 120)).toBe(false);
  });
});

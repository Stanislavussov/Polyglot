import { describe, expect, it } from "vitest";
import { isTextEntry, QUICK_TARGETS, quickTargetFor } from "./mobile-dock";

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

import { describe, expect, it } from "vitest";
import {
  closesFromPanel,
  coveredByKeyboard,
  isScrollDrag,
  keyboardShown,
  liftFor,
  QUICK_TARGETS,
  quickTargetFor,
} from "./mobile-dock";

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

describe("coveredByKeyboard", () => {
  it("is nothing while the keyboard is down", () => {
    expect(coveredByKeyboard(844, 844, 0)).toBe(0);
  });

  it("is the keyboard's height when it covers the bottom of the page", () => {
    expect(coveredByKeyboard(844, 508, 0)).toBe(336);
  });

  it("allows for the page being scrolled up under the keyboard", () => {
    expect(coveredByKeyboard(844, 508, 120)).toBe(216);
  });

  it("never goes below zero when the browser already shrank the page", () => {
    expect(coveredByKeyboard(508, 508, 10)).toBe(0);
  });
});

describe("keyboardShown", () => {
  it("is false when nothing covers or shrinks the page", () => {
    expect(keyboardShown(0, 844, 844)).toBe(false);
  });

  it("is true when the keyboard covers the page (iOS)", () => {
    expect(keyboardShown(336, 508, 844)).toBe(true);
  });

  it("is true when the browser shrank the page for it (Android)", () => {
    expect(keyboardShown(0, 480, 844)).toBe(true);
  });

  it("ignores a small toolbar change", () => {
    expect(keyboardShown(40, 800, 844)).toBe(false);
  });
});

describe("liftFor", () => {
  it("lifts the panel by the keyboard while typing", () => {
    expect(liftFor(true, 336)).toBe(336);
  });

  it("ignores the toolbar collapsing and the scroll bounce", () => {
    expect(liftFor(true, 40)).toBe(0);
  });

  it("follows a small gap too once the keyboard is known to be up, so the box never sinks under it", () => {
    expect(liftFor(true, 40, true)).toBe(40);
  });

  it("never lifts when the box is not being typed in", () => {
    expect(liftFor(false, 336)).toBe(0);
  });
});

describe("isScrollDrag", () => {
  it("is a finger moving the page", () => {
    expect(isScrollDrag(0, 30)).toBe(true);
  });

  it("is not a tap that wobbled a little", () => {
    expect(isScrollDrag(4, 6)).toBe(false);
  });

  it("is not a sideways swipe", () => {
    expect(isScrollDrag(40, 12)).toBe(false);
  });
});

describe("closesFromPanel", () => {
  it("closes the keyboard on a swipe down over the box", () => {
    expect(closesFromPanel(0, 40, false)).toBe(true);
  });

  it("leaves a swipe up alone", () => {
    expect(closesFromPanel(0, -40, false)).toBe(false);
  });

  it("scrolls a long text back up first", () => {
    expect(closesFromPanel(0, 40, true)).toBe(false);
  });
});

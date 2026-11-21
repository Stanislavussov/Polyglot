import { describe, expect, it } from "vitest";
import { atTop, dragAllowed } from "./sheet-drag";

describe("dragAllowed", () => {
  it("lets the header pull the sheet however far the content is scrolled", () => {
    expect(dragAllowed("header", 0)).toBe(true);
    expect(dragAllowed("header", 640)).toBe(true);
  });

  it("lets the content pull the sheet only while it is at the top", () => {
    expect(dragAllowed("body", 0)).toBe(true);
    expect(dragAllowed("body", 1)).toBe(false);
  });

  it("treats the iOS top bounce as the top", () => {
    expect(atTop(-12)).toBe(true);
  });
});

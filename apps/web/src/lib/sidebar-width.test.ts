import { describe, expect, it } from "vitest";
import { layoutForDrag, parseSidebarLayout, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from "./sidebar-width";

describe("layoutForDrag", () => {
  const open = { width: 300, collapsed: false };

  it("follows the pointer inside the allowed range", () => {
    expect(layoutForDrag(310, open)).toEqual({ width: 310, collapsed: false });
  });

  it("stops at the narrowest and widest widths", () => {
    expect(layoutForDrag(180, open)).toEqual({ width: SIDEBAR_MIN, collapsed: false });
    expect(layoutForDrag(900, open)).toEqual({ width: SIDEBAR_MAX, collapsed: false });
  });

  it("folds to icons when dragged far left and keeps the last width for reopening", () => {
    expect(layoutForDrag(80, open)).toEqual({ width: 300, collapsed: true });
  });

  it("reopens when dragged back right", () => {
    expect(layoutForDrag(260, { width: 300, collapsed: true })).toEqual({ width: 260, collapsed: false });
  });
});

describe("parseSidebarLayout", () => {
  it("falls back to the default for missing or broken storage", () => {
    expect(parseSidebarLayout(null)).toEqual({ width: SIDEBAR_DEFAULT, collapsed: false });
    expect(parseSidebarLayout("{oops")).toEqual({ width: SIDEBAR_DEFAULT, collapsed: false });
  });

  it("restores a saved layout, clamped", () => {
    expect(parseSidebarLayout('{"width":9999,"collapsed":true}')).toEqual({ width: SIDEBAR_MAX, collapsed: true });
  });
});

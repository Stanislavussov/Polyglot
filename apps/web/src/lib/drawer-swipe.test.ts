import { describe, expect, it } from "vitest";
import { drawerSwipeAction } from "./drawer-swipe";

describe("drawerSwipeAction", () => {
  it("opens on a rightward swipe from the left edge", () => {
    expect(drawerSwipeAction({ x: 10, y: 300 }, { x: 120, y: 310 }, false)).toBe("open");
  });

  it("ignores a rightward swipe that starts away from the edge", () => {
    expect(drawerSwipeAction({ x: 100, y: 300 }, { x: 250, y: 300 }, false)).toBeNull();
  });

  it("ignores a short swipe", () => {
    expect(drawerSwipeAction({ x: 5, y: 300 }, { x: 40, y: 300 }, false)).toBeNull();
  });

  it("ignores a mostly vertical gesture", () => {
    expect(drawerSwipeAction({ x: 5, y: 100 }, { x: 90, y: 300 }, false)).toBeNull();
  });

  it("closes on a leftward swipe while open", () => {
    expect(drawerSwipeAction({ x: 200, y: 300 }, { x: 60, y: 300 }, true)).toBe("close");
  });

  it("does not close on a rightward swipe while open", () => {
    expect(drawerSwipeAction({ x: 10, y: 300 }, { x: 150, y: 300 }, true)).toBeNull();
  });
});

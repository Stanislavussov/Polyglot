import { describe, expect, it } from "vitest";
import { drawerSwipeAction } from "./drawer-swipe";

const WIDTH = 390;

describe("drawerSwipeAction", () => {
  it("opens on a leftward swipe from the right edge, where the menu lives", () => {
    expect(drawerSwipeAction({ x: 380, y: 300 }, { x: 270, y: 310 }, false, WIDTH)).toBe("open");
  });

  it("ignores a leftward swipe that starts away from the edge", () => {
    expect(drawerSwipeAction({ x: 290, y: 300 }, { x: 140, y: 300 }, false, WIDTH)).toBeNull();
  });

  it("ignores a swipe from the left edge: the menu no longer opens there", () => {
    expect(drawerSwipeAction({ x: 10, y: 300 }, { x: 120, y: 310 }, false, WIDTH)).toBeNull();
  });

  it("ignores a short swipe", () => {
    expect(drawerSwipeAction({ x: 385, y: 300 }, { x: 350, y: 300 }, false, WIDTH)).toBeNull();
  });

  it("ignores a mostly vertical gesture", () => {
    expect(drawerSwipeAction({ x: 385, y: 100 }, { x: 300, y: 300 }, false, WIDTH)).toBeNull();
  });

  it("closes on a rightward swipe while open", () => {
    expect(drawerSwipeAction({ x: 200, y: 300 }, { x: 340, y: 300 }, true, WIDTH)).toBe("close");
  });

  it("does not close on a leftward swipe while open", () => {
    expect(drawerSwipeAction({ x: 380, y: 300 }, { x: 240, y: 300 }, true, WIDTH)).toBeNull();
  });
});

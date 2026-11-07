export interface SwipePoint {
  x: number;
  y: number;
}

// Only a swipe that starts at the very left edge opens the menu, so horizontal scrolling
// (the language chips in the dictionary) never opens it by accident.
const EDGE_PX = 24;
const MIN_DISTANCE_PX = 60;

export function drawerSwipeAction(start: SwipePoint, end: SwipePoint, open: boolean): "open" | "close" | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < MIN_DISTANCE_PX || Math.abs(dy) > Math.abs(dx)) return null;
  if (!open && dx > 0 && start.x <= EDGE_PX) return "open";
  if (open && dx < 0) return "close";
  return null;
}

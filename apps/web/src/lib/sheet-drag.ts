/** Where a pull on the bottom sheet began: the header always drags; the content only while it sits at the top. */
export type DragSource = "header" | "body";

// iOS reports a negative scrollTop during the top bounce, so "at the top" is <= 0, not === 0.
export function atTop(scrollTop: number): boolean {
  return scrollTop <= 0;
}

/** A pull from the header ignores how far the content is scrolled: that was what stopped the swipe after a scroll. */
export function dragAllowed(source: DragSource, scrollTop: number): boolean {
  return source === "header" || atTop(scrollTop);
}

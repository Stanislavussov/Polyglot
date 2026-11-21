import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { PageName } from "./types";

// Phones dock the text box and the quick buttons in one panel at the bottom, like a chat app.
// The shell pads the page by the panel's height so the last answer never hides behind it.
export const DOCK_TARGET = "#composer-dock";
export const dockHeight = ref(0);
export const composerFocused = ref(false);

export type QuickTarget = "translate" | "dictionary" | "review" | "mentor";

export const QUICK_TARGETS: readonly QuickTarget[] = ["translate", "dictionary", "review", "mentor"];

// A page reached from a quick button keeps that button lit (asking about a word is still the dictionary).
export function quickTargetFor(page: PageName): QuickTarget | null {
  if (page === "ask") return "dictionary";
  return (QUICK_TARGETS as readonly string[]).includes(page) ? (page as QuickTarget) : null;
}

// Below md the text box lives in the docked panel; wider screens keep it in the page.
export function useDocked() {
  const docked = ref(typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  let query: MediaQueryList | null = null;
  const onChange = (event: MediaQueryListEvent): void => {
    docked.value = event.matches;
  };
  onMounted(() => {
    query = window.matchMedia("(max-width: 767px)");
    docked.value = query.matches;
    query.addEventListener("change", onChange);
  });
  onBeforeUnmount(() => query?.removeEventListener("change", onChange));
  return docked;
}

// iOS Safari lays the on-screen keyboard over fixed elements instead of shrinking the page,
// so the docked panel would sit behind it, send button included. The visual viewport says how much it covers.
export const keyboardInset = ref(0);
// Focus alone is no sign of a keyboard: the translate box is focused on load with the keyboard down.
// While it is up, the quick buttons step aside so the box sits right on top of it.
export const keyboardUp = ref(false);
// What is left on screen above the keyboard: the panel caps its text box by it, so a long text scrolls inside
// the box instead of pushing the box's top off the screen (iOS keeps dvh at full height under the keyboard).
export const visibleHeight = ref(0);

export function coveredByKeyboard(layoutHeight: number, visibleHeight: number, visibleTop: number): number {
  return Math.max(0, Math.round(layoutHeight - visibleHeight - visibleTop));
}

// Android Chrome shrinks the page for the keyboard instead (interactive-widget=resizes-content),
// so there the sign is a page much shorter than it has been.
export function keyboardShown(inset: number, height: number, tallest: number): boolean {
  return inset > 100 || height < tallest * 0.75;
}

// How far to lift the panel. Small insets are the toolbar collapsing or the rubber-band bounce while
// scrolling: following them made the panel shake, so only a real keyboard moves it.
// Once the keyboard is known to be up, every pixel counts: iOS pans the page under it on the first open.
export function liftFor(focused: boolean, inset: number, up = false): number {
  return focused && (inset > 100 || (up && inset > 0)) ? inset : 0;
}

// A finger moving the page up or down, not a tap that wobbled or a sideways swipe.
export function isScrollDrag(dx: number, dy: number): boolean {
  return Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx);
}

// On the panel only a swipe down closes the keyboard, and only once the text under the finger is scrolled
// to its top — until then the swipe scrolls the text, like a chat app's box.
export function closesFromPanel(dx: number, dy: number, scrolledDown: boolean): boolean {
  return dy > 0 && !scrolledDown && isScrollDrag(dx, dy);
}

function scrolledDownWithin(target: EventTarget | null, panel: HTMLElement): boolean {
  for (let node = target instanceof Element ? target : null; node && node !== panel; node = node.parentElement) {
    if (node.scrollTop > 0) return true;
  }
  return false;
}

// iOS pans the page under a fixed panel while it scrolls with the keyboard up, and the panel can only catch up a
// frame late — it shook and stalled. Chat apps close the keyboard when the page is dragged; so does this one.
function dismissOnScroll(panel: HTMLElement): () => void {
  let start: { x: number; y: number; onPanel: boolean; target: EventTarget | null } | null = null;
  const onStart = (event: TouchEvent): void => {
    const touch = event.touches[0];
    start =
      keyboardUp.value && touch
        ? {
            x: touch.clientX,
            y: touch.clientY,
            onPanel: panel.contains(event.target as Node),
            target: event.target,
          }
        : null;
  };
  const onMove = (event: TouchEvent): void => {
    const touch = event.touches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const closes = start.onPanel
      ? closesFromPanel(dx, dy, scrolledDownWithin(start.target, panel))
      : isScrollDrag(dx, dy);
    if (!closes) return;
    start = null;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: true });
  return () => {
    document.removeEventListener("touchstart", onStart);
    document.removeEventListener("touchmove", onMove);
  };
}

export function trackKeyboard(panel: HTMLElement): () => void {
  const viewport = window.visualViewport;
  let tallest = window.innerHeight;
  let frame = 0;
  const measure = (): void => {
    frame = 0;
    tallest = Math.max(tallest, window.innerHeight);
    const inset = viewport ? coveredByKeyboard(window.innerHeight, viewport.height, viewport.offsetTop) : 0;
    const visible = viewport?.height ?? window.innerHeight;
    keyboardUp.value = composerFocused.value && keyboardShown(inset, visible, tallest);
    keyboardInset.value = liftFor(composerFocused.value, inset, keyboardUp.value);
    visibleHeight.value = Math.round(visible);
  };
  // One measurement per frame at most: scroll events arrive faster than the screen redraws.
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(measure);
  };
  // Scrolling with the keyboard down needs nothing from us, so the visual viewport is only watched while typing.
  const listen = (on: boolean): void => {
    const method = on ? "addEventListener" : "removeEventListener";
    viewport?.[method]("resize", schedule);
    viewport?.[method]("scroll", schedule);
  };
  window.addEventListener("resize", schedule);
  const stopFocus = watch(composerFocused, (focused) => {
    listen(focused);
    schedule();
  });
  const stopDismiss = dismissOnScroll(panel);
  measure();
  return () => {
    stopDismiss();
    listen(false);
    window.removeEventListener("resize", schedule);
    stopFocus();
    if (frame !== 0) cancelAnimationFrame(frame);
    keyboardInset.value = 0;
    keyboardUp.value = false;
  };
}

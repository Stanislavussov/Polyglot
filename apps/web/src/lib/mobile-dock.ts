import { ref, watch } from "vue";
import type { PageName } from "./types";

// Phones dock the text box and the quick buttons at the bottom, like a chat app.
// The shell pads the page by the docked box's height so the last answer never hides behind it.
export const composerHeight = ref(0);
export const composerFocused = ref(false);

export type QuickTarget = "translate" | "dictionary" | "review" | "mentor";

export const QUICK_TARGETS: readonly QuickTarget[] = ["translate", "dictionary", "review", "mentor"];

// A page reached from a quick button keeps that button lit (asking about a word is still the dictionary).
export function quickTargetFor(page: PageName): QuickTarget | null {
  if (page === "ask") return "dictionary";
  return (QUICK_TARGETS as readonly string[]).includes(page) ? (page as QuickTarget) : null;
}

// iOS Safari lays the on-screen keyboard over fixed elements instead of shrinking the page,
// so the docked box would sit behind it, send button included. The visual viewport says how much it covers.
export const keyboardInset = ref(0);
// Focus alone is no sign of a keyboard: the translate box is focused on load with the keyboard down.
// While it is up, the quick buttons step aside so the box sits right on top of it.
export const keyboardUp = ref(false);

export function coveredByKeyboard(layoutHeight: number, visibleHeight: number, visibleTop: number): number {
  return Math.max(0, Math.round(layoutHeight - visibleHeight - visibleTop));
}

// Android Chrome shrinks the page for the keyboard instead (interactive-widget=resizes-content),
// so there the sign is a page much shorter than it has been.
export function keyboardShown(inset: number, height: number, tallest: number): boolean {
  return inset > 100 || height < tallest * 0.75;
}

export function trackKeyboard(): () => void {
  const viewport = window.visualViewport;
  let tallest = window.innerHeight;
  const update = (): void => {
    tallest = Math.max(tallest, window.innerHeight);
    keyboardInset.value = viewport ? coveredByKeyboard(window.innerHeight, viewport.height, viewport.offsetTop) : 0;
    keyboardUp.value =
      composerFocused.value && keyboardShown(keyboardInset.value, viewport?.height ?? window.innerHeight, tallest);
  };
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  const stopFocus = watch(composerFocused, update);
  update();
  return () => {
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    stopFocus();
    keyboardInset.value = 0;
    keyboardUp.value = false;
  };
}

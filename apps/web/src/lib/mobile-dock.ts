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

// The part of the page the eye can see, in page coordinates. iOS pans the whole page up when the keyboard opens,
// so anything fixed to the page (even by svh) slides off the top unless it follows this box.
export const visibleBox = ref({ top: 0, height: typeof window === "undefined" ? 0 : window.innerHeight });

/** Middle of the free space between the page header (or the screen top, once panned past it) and the docked panel. */
export function freeAreaCenter(visibleTop: number, visibleHeight: number, headerBottom: number, dock: number): number {
  const top = Math.max(headerBottom, visibleTop);
  const bottom = visibleTop + visibleHeight - dock;
  return Math.round((top + Math.max(top, bottom)) / 2);
}

/**
 * iOS pans the page up to "reveal" a focused box near the bottom, even when the box already rides above the keyboard
 * and the page has nothing to scroll — the header then vanishes. Undo that pan only on a page that fits the screen:
 * on a longer page the offset is the reader's own scroll.
 */
export function shouldUnpan(keyboardIsUp: boolean, pan: number, pageHeight: number, layoutHeight: number): boolean {
  return keyboardIsUp && pan > 0 && pageHeight <= layoutHeight + 1;
}

// iOS reports the pan as the visual viewport's offset or as a window scroll, depending on the moment:
// the first keyboard of a visit scrolls the window, so watching the offset alone left the header panned away.
export function keyboardPan(visibleTop: number, windowScroll: number): number {
  return Math.max(visibleTop, windowScroll);
}

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
export function liftFor(focused: boolean, inset: number): number {
  return focused && inset > 100 ? inset : 0;
}

// `?debug=keyboard` prints the raw viewport numbers on screen: the phone keyboard can't be reproduced off a real device,
// and three fixes guessed from screenshots alone missed (iOS Chrome with Gboard, first keyboard of a visit).
export const keyboardReadout = ref("");

function readout(viewport: VisualViewport | null, inset: number): string {
  const vv = viewport ? `vv ${Math.round(viewport.height)} top ${Math.round(viewport.offsetTop)}` : "no vv";
  return `inner ${window.innerHeight} ${vv} scroll ${Math.round(window.scrollY)} doc ${document.documentElement.scrollHeight} covered ${inset} lift ${keyboardInset.value} up ${keyboardUp.value} focus ${composerFocused.value}`;
}

export function trackKeyboard(): () => void {
  const debug = new URLSearchParams(window.location.search).get("debug") === "keyboard";
  const viewport = window.visualViewport;
  let tallest = window.innerHeight;
  let frame = 0;
  const measure = (): void => {
    frame = 0;
    tallest = Math.max(tallest, window.innerHeight);
    const inset = viewport ? coveredByKeyboard(window.innerHeight, viewport.height, viewport.offsetTop) : 0;
    const top = viewport?.offsetTop ?? 0;
    const height = viewport?.height ?? window.innerHeight;
    // Polled while typing: a fresh object each time would re-centre the greeting for nothing.
    if (visibleBox.value.top !== top || visibleBox.value.height !== height) visibleBox.value = { top, height };
    keyboardInset.value = liftFor(composerFocused.value, inset);
    keyboardUp.value = composerFocused.value && keyboardShown(inset, viewport?.height ?? window.innerHeight, tallest);
    // The scroll this fires comes back through `schedule`, which re-measures the box with the pan undone.
    if (
      shouldUnpan(
        keyboardUp.value,
        keyboardPan(viewport?.offsetTop ?? 0, window.scrollY),
        document.documentElement.scrollHeight,
        window.innerHeight,
      )
    ) {
      window.scrollTo(0, 0);
    }
    if (debug) keyboardReadout.value = readout(viewport ?? null, inset);
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
    window[method]("scroll", schedule);
  };
  // The first keyboard of a visit grows after it appears (a third-party keyboard such as Gboard loads late, iOS Chrome
  // rebuilds its toolbar) and WebKit sends no event for that, so the panel stayed under the keyboard. While typing the
  // viewport is also polled; a measurement is a few reads, and nothing re-renders unless a number changed.
  let poll = 0;
  const pollWhile = (on: boolean): void => {
    window.clearInterval(poll);
    poll = on ? window.setInterval(schedule, 200) : 0;
  };
  window.addEventListener("resize", schedule);
  // immediate: on a first visit the box can already hold focus when the panel mounts (the box typed into before the
  // app loaded); without it the viewport was never watched and the keyboard covered the box.
  const stopFocus = watch(
    composerFocused,
    (focused, wasFocused) => {
      if (focused !== Boolean(wasFocused)) listen(focused);
      pollWhile(focused);
      schedule();
    },
    { immediate: true },
  );
  return () => {
    listen(false);
    window.removeEventListener("resize", schedule);
    stopFocus();
    pollWhile(false);
    if (frame !== 0) cancelAnimationFrame(frame);
    keyboardInset.value = 0;
    keyboardUp.value = false;
  };
}

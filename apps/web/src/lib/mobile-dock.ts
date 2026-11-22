import { onBeforeUnmount, onMounted, ref } from "vue";
import type { PageName } from "./types";

// Phones keep the quick buttons in a panel at the bottom; the shell pads the page by its height so nothing hides behind it.
// The text box lives at the top of the page, as in DeepL: a box docked over the keyboard needed the keyboard's height,
// which iOS Chrome with Gboard misreports on the first focus of a visit, and four fixes built on it never held.
export const dockHeight = ref(0);

export type QuickTarget = "translate" | "dictionary" | "review" | "mentor";

export const QUICK_TARGETS: readonly QuickTarget[] = ["translate", "dictionary", "review", "mentor"];

// A page reached from a quick button keeps that button lit (asking about a word is still the dictionary).
export function quickTargetFor(page: PageName): QuickTarget | null {
  if (page === "ask") return "dictionary";
  return (QUICK_TARGETS as readonly string[]).includes(page) ? (page as QuickTarget) : null;
}

// Below md the page takes the phone layout: a compact one-row text box and the quick-button panel.
export function usePhoneLayout() {
  const phone = ref(typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  let query: MediaQueryList | null = null;
  const onChange = (event: MediaQueryListEvent): void => {
    phone.value = event.matches;
  };
  onMounted(() => {
    query = window.matchMedia("(max-width: 767px)");
    phone.value = query.matches;
    query.addEventListener("change", onChange);
  });
  onBeforeUnmount(() => query?.removeEventListener("change", onChange));
  return phone;
}

const NOT_TYPED_INTO = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export function isTextEntry(tag: string, type: string, editable: boolean): boolean {
  if (tag === "TEXTAREA" || editable) return true;
  return tag === "INPUT" && !NOT_TYPED_INTO.has(type);
}

function typedInto(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    isTextEntry(target.tagName, target.getAttribute("type") ?? "text", target.isContentEditable)
  );
}

// A phone raises its keyboard only for a field the learner tapped: a page that focuses its search on open (so a desktop
// can type at once) gets no keyboard there, and hiding the panel for that focus made it vanish right after loading.
const TAP_TO_FOCUS_MS = 1000;

export function hidesDock(inTextField: boolean, msSinceTouch: number): boolean {
  return inTextField && msSinceTouch < TAP_TO_FOCUS_MS;
}

// The panel steps aside while the learner types: Android lifts it onto the keyboard, where it only eats the room
// they are typing in, and iOS leaves it floating mid-page once the keyboard pans the page.
export function useTyping() {
  const typing = ref(false);
  let touchedAt = Number.NEGATIVE_INFINITY;
  const onPointerDown = (event: PointerEvent): void => {
    touchedAt = performance.now();
    // A tap on a field the page already focused raises the keyboard without a new focusin.
    if (typedInto(event.target)) typing.value = true;
    // A field removed while focused fires no focusout; the next tap clears what it left behind.
    else if (!typedInto(document.activeElement)) typing.value = false;
  };
  const onFocusIn = (event: FocusEvent): void => {
    typing.value = hidesDock(typedInto(event.target), performance.now() - touchedAt);
  };
  const onFocusOut = (event: FocusEvent): void => {
    if (!typedInto(event.relatedTarget)) typing.value = false;
  };
  onMounted(() => {
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
  });
  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
  });
  return typing;
}

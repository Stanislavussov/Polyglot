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

// Below md the page takes the phone layout (quick-button panel, history behind a button, shorter hints).
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

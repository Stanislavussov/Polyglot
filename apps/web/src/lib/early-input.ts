import { ref } from "vue";

// The translate page shows a plain textarea before the app has loaded, so typing starts at once;
// the app picks up what was typed and where the caret was when it takes over.
export const EARLY_INPUT_ID = "early-input";
export const earlyText = ref("");
export const earlyFocused = ref(false);

declare global {
  interface Window {
    __earlyInput?: string;
  }
}

export function captureEarlyInput(): void {
  const field = document.getElementById(EARLY_INPUT_ID);
  // The page's inline listener keeps the text even if the static field is already gone.
  const typed = field instanceof HTMLTextAreaElement ? field.value : (window.__earlyInput ?? "");
  if (typed.length >= earlyText.value.length) earlyText.value = typed;
  earlyFocused.value ||= document.activeElement === field || !!window.__earlyInput;
}

// The loading page shows the real title from the last visit (in the learner's language), so nothing shifts on load.
const TITLE_KEY = "pageTitle:";

export function rememberedTitle(): string {
  try {
    return localStorage.getItem(TITLE_KEY + window.location.pathname) ?? "";
  } catch {
    return "";
  }
}

export function rememberTitle(): void {
  const title = document.querySelector("main h1.page-title")?.textContent?.trim();
  if (!title) return;
  try {
    localStorage.setItem(TITLE_KEY + window.location.pathname, title);
  } catch {
    // Storage off: the loader just shows an empty title line.
  }
}

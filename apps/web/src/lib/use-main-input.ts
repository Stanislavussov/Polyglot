import { onBeforeUnmount, onMounted } from "vue";

type MainInput = HTMLInputElement | HTMLTextAreaElement;

// Reka-ui dialogs, popovers and menus all carry these roles while open; closing ones are marked data-state="closed".
const OPEN_OVERLAY =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]';

function isTextEntry(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  return (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLInputElement
  );
}

function overlayOpen(): boolean {
  return document.querySelector(OPEN_OVERLAY) !== null;
}

/**
 * Keeps the page's main text field ready: focused on open, refocused after the page changes
 * what is on screen, and reachable by just typing or pressing "/".
 * `focus()` never steals focus from another field or from an open dialog.
 */
export function useMainInput(getInput: () => MainInput | null): { focus: (delayMs?: number) => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function focusNow(): void {
    const input = getInput();
    if (!input || document.activeElement === input) return;
    if (isTextEntry(document.activeElement) || overlayOpen()) return;
    input.focus({ preventScroll: true });
  }

  // After paint: the island mounts while the shell is still laying out, and a focus() then is dropped by some browsers.
  // A delay lets a closing sheet finish its exit animation and hand focus back first.
  function focus(delayMs = 0): void {
    clearTimeout(timer);
    requestAnimationFrame(() => {
      timer = setTimeout(focusNow, delayMs);
    });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const input = getInput();
    if (!input || isTextEntry(document.activeElement) || overlayOpen()) return;
    if (event.key === "/") {
      event.preventDefault();
      input.focus({ preventScroll: true });
    } else if (event.key.length === 1 && event.key !== " ") {
      // Focusing during keydown sends the keystroke's character to the input.
      input.focus({ preventScroll: true });
    }
  }

  onMounted(() => {
    document.addEventListener("keydown", onKeydown);
    focus();
  });
  onBeforeUnmount(() => {
    clearTimeout(timer);
    document.removeEventListener("keydown", onKeydown);
  });

  return { focus };
}

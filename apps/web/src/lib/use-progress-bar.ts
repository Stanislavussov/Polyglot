import { ref } from "vue";
import { readSnoozed, restore, snooze } from "./progress-bar";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// One shared flag, so restoring from the Progress tab and the shell's handle agree without a reload.
const snoozed = ref(readSnoozed(storage(), Date.now()));

export function useProgressBar() {
  return {
    snoozed,
    hide(): void {
      snooze(storage(), Date.now());
      snoozed.value = true;
    },
    show(): void {
      restore(storage());
      snoozed.value = false;
    },
  };
}

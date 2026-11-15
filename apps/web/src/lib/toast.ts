import { ref } from "vue";

export const toastMessage = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

/** A short confirmation at the top of the screen; a newer one replaces the shown one. */
export function toast(message: string): void {
  toastMessage.value = message;
  clearTimeout(timer);
  timer = setTimeout(() => (toastMessage.value = null), 2000);
}

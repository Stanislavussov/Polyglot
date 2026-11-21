<template>
  <!-- Phones only: one panel with its own background, holding the page's text box and the quick buttons.
       It moves with transform, never with bottom/top, so lifting it over the keyboard costs no layout. -->
  <div
    ref="dock"
    class="fixed inset-x-0 bottom-0 z-30 rounded-t-3xl border-t border-line bg-primary-soft shadow-dock will-change-transform md:hidden"
    :class="keyboardUp ? 'pb-2' : 'pb-[env(safe-area-inset-bottom)]'"
    :style="{ transform: `translate3d(0, ${-keyboardInset}px, 0)` }"
  >
    <div id="composer-dock" class="px-3 pt-3 empty:hidden" />
    <QuickNav v-show="!keyboardUp" :class="{ 'pt-1': !hasComposer }" :page="page" @navigate="emit('navigate', $event)" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import { dockHeight, keyboardInset, keyboardUp, trackKeyboard } from "../lib/mobile-dock";
import type { PageName } from "../lib/types";
import QuickNav from "./QuickNav.vue";

defineProps<{ page: PageName }>();
const emit = defineEmits<{ navigate: [page: PageName] }>();

const dock = useTemplateRef<HTMLDivElement>("dock");
const hasComposer = ref(false);

let observer: ResizeObserver | null = null;
let untrack: () => void = () => undefined;
onMounted(() => {
  untrack = trackKeyboard();
  const panel = dock.value;
  if (!panel) return;
  observer = new ResizeObserver(() => {
    // Hidden on wider screens (display: none) measures 0, so the page gets no extra room there.
    dockHeight.value = panel.offsetHeight;
    hasComposer.value = panel.querySelector("form") !== null;
  });
  observer.observe(panel);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  untrack();
});
</script>

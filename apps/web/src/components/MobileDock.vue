<template>
  <!-- Phones only: the quick buttons in a compact panel that is always on screen; the text box sits at the top of the page. -->
  <div
    ref="dock"
    class="fixed inset-x-0 bottom-0 z-30 rounded-t-3xl border-t border-line bg-primary-soft pb-[env(safe-area-inset-bottom)] pt-1 shadow-dock md:hidden"
  >
    <QuickNav :page="page" @navigate="emit('navigate', $event)" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue";
import { dockHeight } from "../lib/mobile-dock";
import type { PageName } from "../lib/types";
import QuickNav from "./QuickNav.vue";

defineProps<{ page: PageName }>();
const emit = defineEmits<{ navigate: [page: PageName] }>();

const dock = useTemplateRef<HTMLDivElement>("dock");

let observer: ResizeObserver | null = null;
onMounted(() => {
  const panel = dock.value;
  if (!panel) return;
  // Hidden on wider screens (display: none) measures 0, so the page gets no extra room then.
  observer = new ResizeObserver(() => {
    dockHeight.value = panel.offsetHeight;
  });
  observer.observe(panel);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

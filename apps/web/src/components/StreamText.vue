<template>
  <!-- Screen readers get the whole text at once; the typing is only for the eyes. -->
  <span><span aria-hidden="true">{{ shown }}</span><span class="sr-only">{{ text }}</span></span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { charsPerFrame, sharedPrefix } from "../lib/stream-text";

const props = defineProps<{ text: string }>();

const shown = ref("");
let frame = 0;

function type(target: string): void {
  cancelAnimationFrame(frame);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    shown.value = target;
    return;
  }
  let at = sharedPrefix(shown.value, target);
  const step = charsPerFrame(target.length - at);
  const tick = (): void => {
    at = Math.min(target.length, at + step);
    shown.value = target.slice(0, at);
    if (at < target.length) frame = requestAnimationFrame(tick);
  };
  tick();
}

watch(() => props.text, type, { immediate: true });
onBeforeUnmount(() => cancelAnimationFrame(frame));
</script>

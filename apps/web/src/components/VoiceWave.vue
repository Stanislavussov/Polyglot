<template>
  <!-- Live bars while listening; a travelling wave while the recording is being read. -->
  <div class="flex w-full items-center gap-3" role="status">
    <div class="flex h-10 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden" aria-hidden="true">
      <span
        v-for="(height, index) in bars"
        :key="index"
        class="w-1 shrink-0 rounded-full bg-primary"
        :class="processing ? 'voice-wave-bar opacity-60' : 'transition-[height] duration-100'"
        :style="processing ? { animationDelay: `${index * 45}ms` } : { height: `${Math.max(4, height * 40)}px` }"
      />
    </div>
    <span class="shrink-0 text-sm text-ink-muted">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

const BARS = 28;

const props = defineProps<{ level: () => number; processing: boolean; label: string }>();

const bars = ref<number[]>(Array.from({ length: BARS }, () => 0));

// ~12 samples a second: smooth enough to read as speech, cheap enough for a phone.
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => {
    if (!props.processing) bars.value = [...bars.value.slice(1), props.level()];
  }, 80);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<style scoped>
.voice-wave-bar {
  height: 6px;
  animation: voice-wave 1s ease-in-out infinite;
}

@keyframes voice-wave {
  0%,
  100% {
    height: 6px;
  }
  50% {
    height: 28px;
  }
}
</style>

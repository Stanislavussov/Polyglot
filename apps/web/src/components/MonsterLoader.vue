<template>
  <!-- `inline`: a small monster beside text-shaped lines, for a paragraph loading inside a card. -->
  <div :class="inline ? 'flex items-start gap-3 py-1' : ['flex flex-col items-center gap-5', compact ? 'py-4' : 'py-10']">
    <svg viewBox="0 0 64 64" class="monster shrink-0 text-surface-muted" :class="inline ? 'size-10' : compact ? 'size-16' : 'size-24'" fill="currentColor" aria-hidden="true">
      <path d="M16 28 L11 7 L32 21 Z" />
      <path d="M48 28 L53 7 L32 21 Z" />
      <path d="M32 14c10.5 0 18.5 7.8 18.5 18.5v5c0 8.3-8.3 14-18.5 14s-18.5-5.7-18.5-14v-5C13.5 21.8 21.5 14 32 14z" />
      <circle cx="24.5" cy="33.5" r="7" class="text-surface" fill="currentColor" />
      <circle cx="39.5" cy="33.5" r="7" class="text-surface" fill="currentColor" />
      <circle cx="25.5" cy="34.5" r="3.2" class="monster-pupil" />
      <circle cx="38.5" cy="34.5" r="3.2" class="monster-pupil" />
    </svg>
    <div v-if="inline" class="min-w-0 flex-1 space-y-2">
      <p v-if="label" class="text-sm font-medium text-ink-muted" role="status">{{ label }}</p>
      <div class="space-y-2" aria-hidden="true">
        <div class="skeleton h-3.5 w-full rounded" />
        <div class="skeleton h-3.5 w-11/12 rounded" />
        <div class="skeleton h-3.5 w-2/3 rounded" />
      </div>
    </div>
    <template v-else>
      <p v-if="label" class="text-center text-sm font-medium text-ink-muted" role="status">{{ label }}</p>
      <div class="w-full max-w-md space-y-3" aria-hidden="true">
        <div class="skeleton mx-auto h-5 w-2/3 rounded" />
        <div class="skeleton h-4 w-full rounded" />
        <div class="skeleton mx-auto h-4 w-5/6 rounded" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label?: string; compact?: boolean; inline?: boolean }>();
</script>

<style scoped>
.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-surface-muted) 0%,
    var(--color-surface-muted) 35%,
    var(--color-line) 50%,
    var(--color-surface-muted) 65%,
    var(--color-surface-muted) 100%
  );
  background-size: 300% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

.monster {
  animation: bob 1.4s ease-in-out infinite;
}

.monster-pupil {
  fill: var(--color-line);
  animation: blink 4.2s infinite;
  transform-box: fill-box;
  transform-origin: center;
}

@keyframes shimmer {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}

@keyframes bob {
  0%, 100% { transform: translateY(0); opacity: 0.85; }
  50% { transform: translateY(-4px); opacity: 1; }
}

@keyframes blink {
  0%, 92%, 100% { transform: scaleY(1); }
  95% { transform: scaleY(0.1); }
}
</style>

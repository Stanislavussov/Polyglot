<template>
  <div class="flex min-h-screen flex-col md:flex-row" aria-busy="true">
    <p class="sr-only" role="status">{{ label }}</p>

    <aside class="hidden w-60 shrink-0 flex-col bg-sidebar md:flex md:h-screen" aria-hidden="true">
      <div class="flex h-16 items-center gap-2.5 whitespace-nowrap px-5 text-lg font-bold tracking-tight text-sidebar-fg"><img src="/favicon.svg" alt="" class="size-8 rounded-lg" /> Polyglot Monster</div>
      <div class="space-y-2 px-3 pt-2">
        <div v-for="width in navWidths" :key="width" class="flex h-11 items-center gap-3 rounded-xl px-3">
          <div class="skeleton-dark size-5 rounded-md" />
          <div class="skeleton-dark h-3 rounded" :style="{ width }" />
        </div>
      </div>
    </aside>

    <header class="flex h-14 items-center gap-3 bg-sidebar px-3 text-sidebar-fg md:hidden" aria-hidden="true">
      <div class="grid size-11 place-items-center"><div class="skeleton-dark h-4 w-6 rounded" /></div>
      <span class="flex items-center gap-2 text-lg font-bold tracking-tight"><img src="/favicon.svg" alt="" class="size-7 rounded-lg" /> Polyglot Monster</span>
    </header>

    <main class="min-w-0 flex-1" aria-hidden="true">
      <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:px-8 md:py-10">
        <div class="skeleton h-8 w-48 rounded-lg" />
        <div class="card mt-6 flex flex-col items-center gap-5 py-10">
          <svg viewBox="0 0 64 64" class="monster size-24 text-surface-muted" fill="currentColor">
            <path d="M16 28 L11 7 L32 21 Z" />
            <path d="M48 28 L53 7 L32 21 Z" />
            <path d="M32 14c10.5 0 18.5 7.8 18.5 18.5v5c0 8.3-8.3 14-18.5 14s-18.5-5.7-18.5-14v-5C13.5 21.8 21.5 14 32 14z" />
            <circle cx="24.5" cy="33.5" r="7" class="text-surface" fill="currentColor" />
            <circle cx="39.5" cy="33.5" r="7" class="text-surface" fill="currentColor" />
            <circle cx="25.5" cy="34.5" r="3.2" class="monster-pupil" />
            <circle cx="38.5" cy="34.5" r="3.2" class="monster-pupil" />
          </svg>
          <div class="w-full max-w-md space-y-3">
            <div class="skeleton mx-auto h-5 w-2/3 rounded" />
            <div class="skeleton h-4 w-full rounded" />
            <div class="skeleton mx-auto h-4 w-5/6 rounded" />
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
// Rendered as static HTML by Astro before the app's JS loads, so it cannot rely on the
// loaded interface language: the caller passes the label in.
defineProps<{ label: string }>();

const navWidths = ["60%", "72%", "52%", "66%"];
</script>

<style scoped>
.skeleton,
.skeleton-dark {
  background: linear-gradient(
    90deg,
    var(--sk-base) 0%,
    var(--sk-base) 35%,
    var(--sk-shine) 50%,
    var(--sk-base) 65%,
    var(--sk-base) 100%
  );
  background-size: 300% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton {
  --sk-base: var(--color-surface-muted);
  --sk-shine: var(--color-line);
}

.skeleton-dark {
  --sk-base: var(--color-sidebar-hover);
  --sk-shine: var(--color-sidebar-active);
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

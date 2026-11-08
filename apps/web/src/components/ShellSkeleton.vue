<template>
  <div class="flex min-h-screen flex-col md:flex-row" aria-busy="true">
    <p class="sr-only" role="status">{{ label }}</p>

    <aside class="hidden w-64 shrink-0 flex-col bg-sidebar md:flex md:h-screen" aria-hidden="true">
      <div class="flex h-16 items-center gap-2.5 whitespace-nowrap px-5 text-lg font-bold tracking-tight text-sidebar-fg"><img src="/favicon.svg" alt="" class="size-8 rounded-lg" /> Polyglot Monster</div>
      <div class="space-y-2 px-3 pt-2">
        <div v-for="width in navWidths" :key="width" class="flex h-11 items-center gap-3 rounded-xl px-3">
          <div class="skeleton-dark size-5 rounded-md" />
          <div class="skeleton-dark h-3 rounded" :style="{ width }" />
        </div>
      </div>
      <div class="mt-auto flex items-center gap-3 border-t border-sidebar-hover p-3">
        <div class="skeleton-dark size-9 rounded-full" />
        <div class="flex-1 space-y-1.5">
          <div class="skeleton-dark h-3 w-24 rounded" />
          <div class="skeleton-dark h-2.5 w-12 rounded" />
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
        <div class="card mt-6"><MonsterLoader /></div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import MonsterLoader from "./MonsterLoader.vue";

// Rendered as static HTML by Astro before the app's JS loads, so it cannot rely on the
// loaded interface language: the caller passes the label in.
defineProps<{ label: string }>();

const navWidths = ["60%", "72%", "52%", "58%", "66%"];
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



@keyframes shimmer {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}


</style>

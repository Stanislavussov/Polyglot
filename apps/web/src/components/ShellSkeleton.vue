<template>
  <div class="flex min-h-screen flex-col md:flex-row" aria-busy="true">
    <p class="sr-only" role="status">{{ label }}</p>
    <!-- First open only (no cached settings, see BaseLayout): an empty screen with the monster, until the first fetch lands. -->
    <div class="shell-splash fixed inset-0 z-50 place-items-center bg-canvas" aria-hidden="true">
      <img src="/favicon.svg" alt="" class="shell-splash-icon size-20 rounded-2xl" />
    </div>
    <div class="shell-body contents">
      <aside class="app-sidebar hidden shrink-0 flex-col overflow-hidden bg-sidebar md:flex md:h-screen" aria-hidden="true">
        <div class="flex h-16 items-center gap-2.5 whitespace-nowrap px-5 text-xl font-bold tracking-tight text-sidebar-fg"><img src="/favicon.svg" alt="" class="size-8 rounded-lg" /> Polyglot Monster</div>
        <div class="space-y-2 px-3 pt-2">
          <div v-for="width in navWidths" :key="width" class="flex h-11 items-center gap-3 rounded-xl px-3">
            <div class="skeleton-dark size-5 rounded-md" />
            <div class="sb-label skeleton-dark h-3 rounded" :style="{ width }" />
          </div>
        </div>
        <div class="mt-auto flex items-center gap-3 border-t border-sidebar-hover p-3">
          <div class="skeleton-dark size-9 rounded-full" />
          <div class="sb-label flex-1 space-y-1.5">
            <div class="skeleton-dark h-3 w-24 rounded" />
            <div class="skeleton-dark h-2.5 w-12 rounded" />
          </div>
        </div>
      </aside>

      <header class="flex h-14 items-center gap-3 bg-sidebar px-3 text-sidebar-fg md:hidden" aria-hidden="true">
        <div class="grid size-11 place-items-center"><div class="skeleton-dark h-4 w-6 rounded" /></div>
        <span class="flex items-center gap-2 text-xl font-bold tracking-tight"><img src="/favicon.svg" alt="" class="size-7 rounded-lg" /> Polyglot Monster</span>
      </header>

      <main class="min-w-0 flex-1" :aria-hidden="placeholder ? undefined : 'true'">
        <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:px-8 md:py-10">
          <!-- Same line as the page's own title; the inline script in BaseLayout fills it before the app loads. -->
          <h1 class="page-title" data-early-title>{{ title || "\u00a0" }}</h1>
          <!-- The input needs nothing from the server: typing starts before the app has loaded. -->
          <!-- A copy of the translate page's ComposerCard, box for box, so nothing moves when the app takes over. -->
          <div v-if="placeholder" class="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] xl:items-start">
            <!-- Phones: the bottom panel of MobileDock, with room under the box for the quick buttons drawn over it. -->
            <div class="fixed inset-x-0 bottom-0 z-30 rounded-t-3xl border-t border-line bg-primary-soft px-3 pb-[calc(3.5rem+env(safe-area-inset-bottom))] pt-3 shadow-dock md:static md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none xl:col-start-1 xl:row-start-1">
              <div class="rounded-3xl border border-line bg-surface p-3 transition-colors focus-within:border-ring md:shadow-card">
                <label class="sr-only" :for="EARLY_INPUT_ID">{{ placeholder }}</label>
                <textarea
                  :id="EARLY_INPUT_ID"
                  v-model="earlyText"
                  class="block max-h-[40dvh] min-h-11 w-full resize-none bg-transparent px-2 py-2 text-base text-ink placeholder:text-ink-muted focus:outline-none md:min-h-20"
                  rows="1"
                  maxlength="500"
                  autofocus
                  :placeholder="placeholder"
                />
                <div class="flex items-center gap-2" aria-hidden="true">
                  <span class="grid size-11 place-items-center rounded-full text-ink-muted"><Mic class="size-5" /></span>
                  <span class="ml-auto grid size-11 place-items-center rounded-full bg-primary-soft text-primary-soft-fg"><ArrowUp class="size-5" /></span>
                </div>
              </div>
              <p class="relative mt-2 hidden px-3 text-sm md:block [@media(pointer:coarse)]:hidden" aria-hidden="true">&nbsp;<span class="skeleton absolute inset-y-1 left-3 w-64 max-w-full rounded" /></p>
            </div>
            <div class="card xl:col-start-2 xl:row-span-2 xl:row-start-1" aria-hidden="true">
              <div class="skeleton h-4 w-40 rounded" />
            </div>
          </div>
          <div v-else class="card mt-6"><MonsterLoader /></div>
        </div>
      </main>

      <!-- The quick buttons of the loaded app, shape for shape; on pages without the box they bring the panel themselves. -->
      <div
        class="fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] md:hidden"
        :class="placeholder ? '' : 'rounded-t-3xl border-t border-line bg-primary-soft pt-1 shadow-dock'"
        aria-hidden="true"
      >
        <div class="grid h-14 grid-cols-4 items-center gap-1 px-2">
          <div v-for="n in 4" :key="n" class="mx-auto grid h-11 w-16 place-items-center"><div class="skeleton size-6 rounded-md" /></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowUp, Mic } from "lucide-vue-next";
import { onMounted } from "vue";
import { EARLY_INPUT_ID, earlyFocused, earlyText, rememberedTitle } from "../lib/early-input";
import MonsterLoader from "./MonsterLoader.vue";

// Rendered as static HTML by Astro before the app's JS loads, so it cannot rely on the
// loaded interface language: the caller passes the label in.
// `placeholder` turns the page's body into a usable input (the translate page).
const props = defineProps<{ label: string; placeholder?: string }>();

// Astro renders this on the server, where there is no storage: the inline script fills it there.
const title = typeof window === "undefined" ? "" : rememberedTitle();

onMounted(() => {
  const field = document.getElementById(EARLY_INPUT_ID);
  if (props.placeholder && earlyFocused.value && field instanceof HTMLTextAreaElement) {
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }
});

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

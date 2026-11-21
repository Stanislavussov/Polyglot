<template>
  <!-- The translate card's own shape, block for block — language row, word, synonyms, note, then a translation —
       so the real card lands in place instead of pushing the page around. The monster dances by the word. -->
  <div class="card space-y-5" aria-busy="true">
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2" aria-hidden="true">
        <div class="flex items-center gap-2.5">
          <div class="skeleton h-9 w-28 rounded-full" />
          <div class="skeleton size-6 rounded-full" />
        </div>
        <div class="skeleton size-11 rounded-full" />
      </div>
      <div class="flex items-center gap-3" aria-hidden="true">
        <div class="skeleton size-9 shrink-0 rounded-xl" />
        <div class="skeleton h-8 w-2/5 max-w-48 rounded-lg" />
      </div>
      <MonsterThinking :label="label" />
      <div class="flex flex-wrap gap-2" aria-hidden="true">
        <div v-for="width in CHIPS" :key="width" class="skeleton h-8 rounded-full" :class="width" />
      </div>
      <div class="space-y-2 rounded-xl bg-surface-muted px-4 py-3" aria-hidden="true">
        <div class="skeleton-on-muted h-3.5 w-full rounded" />
        <div class="skeleton-on-muted h-3.5 w-3/4 rounded" />
      </div>
    </div>
    <div class="space-y-2 border-t border-line pt-4" aria-hidden="true">
      <div class="skeleton h-3.5 w-24 rounded" />
      <div class="skeleton h-7 w-1/2 max-w-56 rounded-lg" />
      <div class="space-y-2 border-l-2 border-line pl-3 pt-1">
        <div class="skeleton h-3.5 w-5/6 rounded" />
        <div class="skeleton h-3.5 w-2/3 rounded" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import MonsterThinking from "./MonsterThinking.vue";

defineProps<{ label: string }>();

const CHIPS = ["w-16", "w-20", "w-14"];
</script>

<style scoped>
.skeleton,
.skeleton-on-muted {
  background: linear-gradient(90deg, var(--sk-base) 0%, var(--sk-base) 35%, var(--sk-shine) 50%, var(--sk-base) 65%, var(--sk-base) 100%);
  background-size: 300% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton {
  --sk-base: var(--color-surface-muted);
  --sk-shine: var(--color-line);
}

.skeleton-on-muted {
  --sk-base: var(--color-line);
  --sk-shine: var(--color-surface);
}

@keyframes shimmer {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}
</style>

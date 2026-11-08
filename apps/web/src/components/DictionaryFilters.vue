<template>
  <div class="space-y-5">
    <fieldset v-for="group in groups" :key="group.key">
      <legend class="mb-2 text-sm font-semibold">{{ t(group.label) }}</legend>
      <!-- Options that do not fit move to a new row whole; their text never breaks inside a button. -->
      <div class="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
        <button
          v-for="option in group.options"
          :key="option.value"
          type="button"
          :aria-pressed="modelValue[group.key] === option.value"
          :class="[
            'min-h-9 flex-auto whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors',
            modelValue[group.key] === option.value ? 'bg-primary text-primary-fg' : 'text-ink-muted hover:bg-surface-muted',
          ]"
          @click="emit('update', group.key, option.value)"
        >
          {{ t(option.label) }}
        </button>
      </div>
    </fieldset>
    <button type="button" class="btn-secondary w-full" :disabled="activeCount === 0" @click="emit('reset')">
      {{ t("web.dictionary.filterReset") }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { t } from "../lib/i18n";
import type { DictionaryFilterState } from "../lib/types";

type Key = "type" | "difficulty" | "review";

defineProps<{ modelValue: DictionaryFilterState; activeCount: number }>();
const emit = defineEmits<{ update: [key: Key, value: string]; reset: [] }>();

const all = { value: "", label: "web.dictionary.filterAll" };

const groups = [
  {
    key: "type",
    label: "web.dictionary.filterType",
    options: [
      all,
      { value: "word", label: "web.dictionary.typeWord" },
      { value: "phrase", label: "web.dictionary.typePhrase" },
      { value: "sentence", label: "web.dictionary.typeSentence" },
    ],
  },
  {
    key: "difficulty",
    label: "web.dictionary.difficulty",
    options: [
      all,
      { value: "hard", label: "web.dictionary.difficulty.hard" },
      { value: "normal", label: "web.dictionary.difficulty.normal" },
      { value: "easy", label: "web.dictionary.difficulty.easy" },
    ],
  },
  {
    key: "review",
    label: "web.dictionary.filterReview",
    options: [
      all,
      { value: "due", label: "web.dictionary.reviewDue" },
      { value: "new", label: "web.dictionary.reviewNew" },
      { value: "learned", label: "web.dictionary.reviewLearned" },
    ],
  },
] as const satisfies readonly { key: Key; label: string; options: readonly { value: string; label: string }[] }[];
</script>

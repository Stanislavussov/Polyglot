<template>
  <div>
    <div v-if="title || items.length > 0" :class="['flex items-center gap-3', title ? 'justify-between' : 'justify-end']">
      <h2 v-if="title" class="min-w-0 text-sm font-bold">{{ title }}</h2>
      <button
        v-if="items.length > 0"
        type="button"
        class="-mr-2 min-h-11 shrink-0 whitespace-nowrap rounded-full px-2 text-sm font-semibold text-primary hover:text-primary-hover"
        @click="emit('clear')"
      >
        {{ t("web.translate.clearHistory") }}
      </button>
    </div>
    <slot name="top" />
    <p v-if="items.length === 0" class="mt-2 text-sm text-ink-muted">{{ emptyText }}</p>
    <ul v-else class="mt-2 divide-y divide-line">
      <li v-for="item in items" :key="item.key" class="flex items-center gap-2">
        <button
          type="button"
          class="flex min-h-11 min-w-0 flex-1 items-center py-2 text-left hover:text-primary"
          :class="{ 'text-primary': item.current }"
          :aria-current="item.current ? 'true' : undefined"
          @click="emit('open', item.key)"
        >
          <span class="min-w-0 truncate font-medium"><span v-if="item.emoji" class="mr-2" aria-hidden="true">{{ item.emoji }}</span>{{ item.label }}</span>
        </button>
        <button
          type="button"
          class="inline-flex size-11 shrink-0 items-center justify-center text-ink-muted hover:text-danger"
          :aria-label="removeLabel(item.label)"
          :title="removeLabel(item.label)"
          @click="emit('forget', item.key)"
        >
          <Trash2 class="size-4" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { Trash2 } from "lucide-vue-next";
import { t } from "../lib/i18n";

export interface HistoryItem {
  key: string;
  label: string;
  emoji?: string | null;
  /** The entry open on screen right now. */
  current?: boolean;
}

defineProps<{ items: HistoryItem[]; title?: string; emptyText: string; removeLabel: (label: string) => string }>();
const emit = defineEmits<{ open: [key: string]; forget: [key: string]; clear: [] }>();
</script>

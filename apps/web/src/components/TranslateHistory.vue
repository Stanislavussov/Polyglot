<template>
  <div>
    <div v-if="titled || items.length > 0" :class="['flex items-center gap-3', titled ? 'justify-between' : 'justify-end']">
      <h2 v-if="titled" class="min-w-0 truncate text-sm font-bold">{{ t("web.translate.recent") }}</h2>
      <button
        v-if="items.length > 0"
        type="button"
        class="-mr-2 min-h-11 shrink-0 whitespace-nowrap rounded-full px-2 text-sm font-semibold text-primary hover:text-primary-hover"
        @click="emit('clear')"
      >
        {{ t("web.translate.clearHistory") }}
      </button>
    </div>
    <p v-if="items.length === 0" class="mt-2 text-sm text-ink-muted">{{ t("web.translate.recentEmpty") }}</p>
    <ul v-else class="mt-2 divide-y divide-line">
      <li v-for="item in items" :key="keyOf(item)" class="flex items-center gap-2">
        <button type="button" class="flex min-h-11 min-w-0 flex-1 items-center py-2 text-left hover:text-primary" @click="emit('open', item)">
          <span class="min-w-0 truncate font-medium"><span v-if="item.emoji" class="mr-2" aria-hidden="true">{{ item.emoji }}</span>{{ item.original }}</span>
        </button>
        <button
          type="button"
          class="inline-flex size-11 shrink-0 items-center justify-center text-ink-muted hover:text-danger"
          :aria-label="t('web.translate.removeFromHistory', { word: item.original })"
          :title="t('web.translate.removeFromHistory', { word: item.original })"
          @click="emit('forget', item)"
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
import type { TranslateResult } from "../lib/types";

defineProps<{ items: TranslateResult[]; keyOf: (item: TranslateResult) => string; titled?: boolean }>();
const emit = defineEmits<{ open: [item: TranslateResult]; forget: [item: TranslateResult]; clear: [] }>();
</script>

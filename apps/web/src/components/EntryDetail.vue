<template>
  <div v-if="failed" class="space-y-3">
    <p role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>
    <button type="button" class="btn-secondary" @click="emit('retry')">{{ t("web.common.retry") }}</button>
  </div>

  <div v-else-if="!entry" class="space-y-4" aria-busy="true">
    <p class="sr-only" role="status">{{ t("web.common.loading") }}</p>
    <div class="h-4 w-24 animate-pulse rounded bg-surface-muted" />
    <div class="h-7 w-2/3 animate-pulse rounded bg-surface-muted" />
    <div class="space-y-3 border-t border-line pt-4">
      <div class="h-4 w-20 animate-pulse rounded bg-surface-muted" />
      <div class="h-6 w-1/2 animate-pulse rounded bg-surface-muted" />
      <div class="h-4 w-full animate-pulse rounded bg-surface-muted" />
      <div class="h-4 w-5/6 animate-pulse rounded bg-surface-muted" />
    </div>
  </div>

  <div v-else class="space-y-5">
    <p><LangBadge :code="entry.sourceLang" /></p>

    <EntryLangSection v-if="split.native" :detail="split.native" />

    <div v-if="entry.nativeMeaning || entry.difficulty" class="space-y-2">
      <p v-if="entry.nativeMeaning" class="text-base">
        <span class="font-semibold text-ink-muted">{{ t("web.translate.nativeMeaning") }}:</span> {{ entry.nativeMeaning }}
      </p>
      <p v-if="entry.difficulty" class="text-sm">
        <span class="font-semibold text-ink-muted">{{ t("web.dictionary.difficulty") }}:</span> {{ t(`web.dictionary.difficulty.${entry.difficulty}`) }}
      </p>
    </div>

    <div v-if="entry.sourceUsage" class="space-y-2 rounded-xl bg-surface-muted px-4 py-3 text-base">
      <h3 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.translate.aboutSource") }}</h3>
      <p v-if="entry.sourceUsage.headword" class="font-semibold">{{ entry.sourceUsage.headword }}</p>
      <p>{{ entry.sourceUsage.explanation }}</p>
      <ul v-if="entry.sourceUsage.synonyms.length > 0" class="flex flex-wrap gap-2">
        <li v-for="synonym in entry.sourceUsage.synonyms" :key="synonym" class="rounded-full bg-primary-soft px-3 py-1 text-primary-soft-fg">{{ synonym }}</li>
      </ul>
      <ExampleList :examples="entry.sourceUsage.examples" />
    </div>

    <EntryLangSection v-for="detail in split.others" :key="detail.lang" :detail="detail" />
  </div>
</template>

<script setup lang="ts">
import LangBadge from "./LangBadge.vue";
import { computed } from "vue";
import { splitNative } from "../lib/card-order";
import { t } from "../lib/i18n";
import { languageName, settings } from "../lib/settings-store";
import type { EntryDetail } from "../lib/types";
import EntryLangSection from "./EntryLangSection.vue";
import ExampleList from "./ExampleList.vue";

const props = defineProps<{ entry: EntryDetail | null; failed: boolean }>();
const emit = defineEmits<{ retry: [] }>();

const split = computed(() => splitNative(props.entry?.details ?? [], settings.value?.nativeLang));
</script>

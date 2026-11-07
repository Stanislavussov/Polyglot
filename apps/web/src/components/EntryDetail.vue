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
    <div class="space-y-2">
      <p class="text-sm text-ink-muted">
        <span aria-hidden="true">{{ languageFlag(entry.sourceLang) }}</span> {{ languageName(entry.sourceLang) }}
      </p>
      <p v-if="entry.nativeMeaning" class="text-sm">
        <span class="font-semibold text-ink-muted">{{ t("web.translate.nativeMeaning") }}:</span> {{ entry.nativeMeaning }}
      </p>
      <p v-if="entry.difficulty" class="text-sm">
        <span class="font-semibold text-ink-muted">{{ t("web.dictionary.difficulty") }}:</span> {{ t(`web.dictionary.difficulty.${entry.difficulty}`) }}
      </p>
    </div>

    <div v-if="entry.sourceUsage" class="space-y-2 rounded-xl bg-surface-muted px-4 py-3 text-sm">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.translate.aboutSource") }}</h3>
      <p v-if="entry.sourceUsage.headword" class="font-semibold">{{ entry.sourceUsage.headword }}</p>
      <p>{{ entry.sourceUsage.explanation }}</p>
      <ul v-if="entry.sourceUsage.synonyms.length > 0" class="flex flex-wrap gap-2">
        <li v-for="synonym in entry.sourceUsage.synonyms" :key="synonym" class="rounded-full bg-primary-soft px-3 py-1 text-primary-soft-fg">{{ synonym }}</li>
      </ul>
      <ExampleList :examples="entry.sourceUsage.examples" />
    </div>

    <section v-for="detail in entry.details" :key="detail.lang" class="border-t border-line pt-4">
      <p class="text-sm text-ink-muted">
        <span aria-hidden="true">{{ languageFlag(detail.lang) }}</span> {{ languageName(detail.lang) }}
      </p>
      <p class="mt-1 break-words text-lg font-semibold text-primary">
        {{ detail.text }}
        <span v-if="detail.expressionType" class="ml-2 inline-block rounded-full bg-primary-soft px-2 py-0.5 align-middle text-xs font-medium text-primary-soft-fg">{{ detail.expressionType }}</span>
      </p>
      <p v-if="detail.equivalentNote" class="mt-2 text-sm text-ink-muted">{{ detail.equivalentNote }}</p>
      <p v-if="detail.usageNote" class="mt-2 text-sm">{{ detail.usageNote }}</p>
      <p v-if="detail.connotationWarning" class="mt-2 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-fg">
        <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{{ detail.connotationWarning }}
      </p>
      <ul v-if="detail.synonyms.length > 0" class="mt-3 flex flex-wrap gap-2" :aria-label="t('web.translate.synonyms')">
        <li v-for="synonym in detail.synonyms" :key="synonym" class="rounded-full bg-primary-soft px-3 py-1 text-sm text-primary-soft-fg">{{ synonym }}</li>
      </ul>
      <div v-if="detail.alternatives.length > 0" class="mt-3">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.translate.alternatives") }}</h3>
        <ul class="mt-1 flex flex-wrap gap-2">
          <li v-for="alternative in detail.alternatives" :key="alternative" class="rounded-full border border-line px-3 py-1 text-sm">{{ alternative }}</li>
        </ul>
      </div>
      <ExampleList class="mt-3" :examples="detail.examples" />

      <p class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span class="inline-flex items-center gap-1 font-semibold">
          <CalendarClock class="size-4" aria-hidden="true" />{{ t("web.dictionary.schedule") }}:
        </span>
        <span>{{ schedule(detail.review) }}</span>
        <span>{{ t("web.dictionary.interval", { days: detail.review.intervalDays }) }}</span>
        <span>{{ t("web.dictionary.reviewCount", { count: detail.review.reviewCount }) }}</span>
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { CalendarClock, TriangleAlert } from "lucide-vue-next";
import { formatDue } from "../lib/format";
import { lang, t } from "../lib/i18n";
import { languageFlag, languageName } from "../lib/settings-store";
import type { EntryDetail, EntryReviewState } from "../lib/types";
import ExampleList from "./ExampleList.vue";

defineProps<{ entry: EntryDetail | null; failed: boolean }>();
const emit = defineEmits<{ retry: [] }>();

function schedule(review: EntryReviewState): string {
  if (!review.dueAt) return t("web.dictionary.notScheduled");
  const { due, time } = formatDue(review.dueAt, lang.value);
  return due ? t("web.dictionary.dueNow") : t("web.dictionary.nextReview", { time });
}
</script>

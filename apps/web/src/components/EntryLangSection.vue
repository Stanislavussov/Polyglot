<template>
  <section class="border-t border-line pt-4">
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
</template>

<script setup lang="ts">
import { CalendarClock, TriangleAlert } from "lucide-vue-next";
import { formatDue } from "../lib/format";
import { lang, t } from "../lib/i18n";
import { languageFlag, languageName } from "../lib/settings-store";
import type { EntryDetail, EntryReviewState } from "../lib/types";
import ExampleList from "./ExampleList.vue";

defineProps<{ detail: EntryDetail["details"][number] }>();

function schedule(review: EntryReviewState): string {
  if (!review.dueAt) return t("web.dictionary.notScheduled");
  const { due, time } = formatDue(review.dueAt, lang.value);
  return due ? t("web.dictionary.dueNow") : t("web.dictionary.nextReview", { time });
}
</script>

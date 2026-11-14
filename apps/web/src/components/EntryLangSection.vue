<template>
  <section class="border-t border-line pt-4">
    <LangBadge :code="detail.lang" />
    <WordHeadline class="mt-2" tone="primary" :text="detail.text">
      <template #after>
        <SpeakButton
          v-if="entryId !== undefined && audio && audio !== 'off' && speaks"
          small
          :entry-id="entryId"
          :lang="detail.lang"
          :text="detail.text"
          :access="audio"
          @notice="(key) => emit('notice', key)"
        /><span v-if="detail.expressionType" class="inline-block rounded-full bg-primary-soft px-2 py-0.5 text-sm font-medium text-primary-soft-fg">{{ detail.expressionType }}</span></template>
    </WordHeadline>
    <p v-if="detail.equivalentNote" class="mt-2 text-base text-ink-muted">{{ detail.equivalentNote }}</p>
    <p v-if="detail.usageNote" class="mt-2 text-base">{{ detail.usageNote }}</p>
    <p v-if="detail.connotationWarning" class="mt-2 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-base text-warning-fg">
      <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{{ detail.connotationWarning }}
    </p>
    <ul v-if="detail.synonyms.length > 0" class="mt-3 flex flex-wrap gap-2" :aria-label="t('web.translate.synonyms')">
      <li v-for="synonym in detail.synonyms" :key="synonym" class="rounded-full bg-primary-soft px-3 py-1 text-base text-primary-soft-fg">{{ synonym }}</li>
    </ul>
    <div v-if="detail.alternatives.length > 0" class="mt-3">
      <h3 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.translate.alternatives") }}</h3>
      <ul class="mt-1 flex flex-wrap gap-2">
        <li v-for="alternative in detail.alternatives" :key="alternative" class="rounded-full border border-line px-3 py-1 text-base">{{ alternative }}</li>
      </ul>
    </div>
    <ExampleList class="mt-3" :examples="detail.examples" />

    <!-- Simplicity first: an action when there is something to do, one friendly line otherwise. -->
    <a v-if="entryId !== undefined && cta" :href="`/review/?entry=${entryId}`" class="btn-secondary mt-3 !text-primary">
      <RotateCw class="size-4" aria-hidden="true" />{{ t(cta) }}
    </a>
    <p v-else class="mt-3 flex items-center gap-2 text-sm text-ink-muted">
      <CalendarClock class="size-4 shrink-0" aria-hidden="true" />{{ schedule(detail.review) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import LangBadge from "./LangBadge.vue";
import WordHeadline from "./word/WordHeadline.vue";
import { CalendarClock, RotateCw, TriangleAlert } from "lucide-vue-next";
import { computed } from "vue";
import { formatDue } from "../lib/format";
import { lang, t } from "../lib/i18n";
import { languageName } from "../lib/settings-store";
import type { AudioAccess, EntryDetail, EntryReviewState } from "../lib/types";
import SpeakButton from "./SpeakButton.vue";
import ExampleList from "./ExampleList.vue";

// Speaker props are optional: without them the section is read-only (no voice for this language).
const props = defineProps<{ detail: EntryDetail["details"][number]; entryId?: number; audio?: AudioAccess; speaks?: boolean }>();
const emit = defineEmits<{ notice: [key: string] }>();

// Due or never practised: worth a tap, so it is a button, not a status.
const cta = computed(() => {
  const review = props.detail.review;
  if (!review.dueAt) return null;
  if (review.reviewCount === 0) return "web.dictionary.startLearning";
  return formatDue(review.dueAt, lang.value).due ? "web.dictionary.reviewNow" : null;
});

function schedule(review: EntryReviewState): string {
  if (!review.dueAt) return t("web.dictionary.notScheduled");
  if (review.mature) return t("web.dictionary.reviewWellKnown");
  return t("web.dictionary.nextReview", { time: formatDue(review.dueAt, lang.value).time });
}
</script>

<template>
  <div class="border-t border-line pt-4">
    <p class="text-sm text-ink-muted">
      <span aria-hidden="true">{{ languageFlag(translation.lang) }}</span> {{ languageName(translation.lang) }}
    </p>
    <div class="mt-1 flex items-start justify-between gap-3">
      <p class="min-w-0 break-words text-lg font-semibold text-primary">
        {{ translation.text }}
        <span v-if="translation.expressionType" class="ml-2 inline-block rounded-full bg-primary-soft px-2 py-0.5 align-middle text-xs font-medium text-primary-soft-fg">
          {{ translation.expressionType }}
        </span>
      </p>
      <div class="flex shrink-0 gap-2">
        <slot name="actions" />
        <button
          type="button"
          class="btn-secondary !px-3"
          :aria-label="t('web.translate.copyLabel', { text: translation.text })"
          @click="copy"
        >
          <Check v-if="copied" class="size-4" aria-hidden="true" />
          <Copy v-else class="size-4" aria-hidden="true" />
          <span class="hidden sm:inline">{{ copied ? t("web.translate.copied") : t("web.translate.copy") }}</span>
        </button>
      </div>
    </div>

    <p v-if="translation.equivalentNote" class="mt-2 text-base text-ink-muted">{{ translation.equivalentNote }}</p>
    <p v-if="translation.connotationWarning" class="mt-2 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-fg">
      <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {{ translation.connotationWarning }}
    </p>
    <ul v-if="translation.synonyms.length > 0" class="mt-3 flex flex-wrap gap-2" :aria-label="t('web.translate.synonyms')">
      <li v-for="synonym in translation.synonyms" :key="synonym" class="rounded-full bg-primary-soft px-3 py-1 text-sm text-primary-soft-fg">
        {{ synonym }}
      </li>
    </ul>
    <ExampleList class="mt-3" :examples="translation.examples.slice(0, 1)" />

    <template v-if="hasMore">
      <div v-if="expanded" :id="moreId" class="mt-3 space-y-3">
        <p v-if="translation.usageNote" class="text-base">{{ translation.usageNote }}</p>
        <div v-if="translation.alternatives.length > 0">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.translate.alternatives") }}</h3>
          <ul class="mt-1 flex flex-wrap gap-2">
            <li v-for="alternative in translation.alternatives" :key="alternative" class="rounded-full border border-line px-3 py-1 text-sm">
              {{ alternative }}
            </li>
          </ul>
        </div>
        <ExampleList v-if="translation.examples.length > 1" :examples="translation.examples.slice(1)" />
      </div>
      <button
        type="button"
        class="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"
        :aria-expanded="expanded"
        :aria-controls="moreId"
        @click="expanded = !expanded"
      >
        <ChevronDown class="size-4 transition-transform" :class="{ 'rotate-180': expanded }" aria-hidden="true" />
        {{ expanded ? t("web.translate.showLess") : t("web.translate.showMore") }}
      </button>
    </template>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { Check, ChevronDown, Copy, TriangleAlert } from "lucide-vue-next";
import { computed, onBeforeUnmount, ref } from "vue";
import { t } from "../lib/i18n";
import { languageFlag, languageName } from "../lib/settings-store";
import type { TranslateTarget } from "../lib/types";
import ExampleList from "./ExampleList.vue";

const COPIED_MS = 1800;

const props = defineProps<{ translation: TranslateTarget; idPrefix: string }>();

const expanded = ref(false);
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

const moreId = computed(() => `${props.idPrefix}-more-${props.translation.lang}`);
const hasMore = computed(
  () => Boolean(props.translation.usageNote) || props.translation.alternatives.length > 0 || props.translation.examples.length > 1,
);

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.translation.text);
  } catch {
    return;
  }
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copied.value = false;
  }, COPIED_MS);
}

onBeforeUnmount(() => clearTimeout(copiedTimer));
</script>

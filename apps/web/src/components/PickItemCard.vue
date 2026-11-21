<template>
  <WordCard as="li" padding="md">
    <WordHeadline class="pt-2" :size="headlineSizeFor(item.word)" :text="item.word" :emoji="item.emoji" />

    <!-- Same place and shape as the translate card's save: the word column keeps the full width on a phone. -->
    <template #aside>
      <button v-if="item.saved" type="button" :class="SAVED_BTN" disabled :title="t('web.common.saved')" :aria-label="t('web.common.saved')">
        <BookmarkCheck class="size-4" stroke-width="2.5" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.common.saved") }}</span>
      </button>
      <button v-else type="button" :class="SAVE_BTN" :disabled="saving" :title="t('web.translate.save')" :aria-label="t('web.translate.save')" @click="emit('save')">
        <BookmarkPlus class="size-4" stroke-width="2.5" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.translate.save") }}</span>
      </button>
    </template>

    <template #body>
      <TranslationLines :lines="[{ lang: nativeLang, text: item.nativeTranslation }]" size="xl" />
      <p v-if="item.note" class="text-base text-ink-muted">{{ item.note }}</p>
      <ExampleList :examples="examples" />
    </template>
  </WordCard>
</template>

<script setup lang="ts">
import { BookmarkCheck, BookmarkPlus } from "lucide-vue-next";
import { computed } from "vue";
import { t } from "../lib/i18n";
import type { PickItem } from "../lib/learn-api";
import type { TranslateExample } from "../lib/types";
import { headlineSizeFor } from "../lib/word-card";
import ExampleList from "./ExampleList.vue";
import TranslationLines from "./word/TranslationLines.vue";
import WordCard from "./word/WordCard.vue";
import WordHeadline from "./word/WordHeadline.vue";

const props = defineProps<{ item: PickItem; nativeLang: string; saving?: boolean }>();
const emit = defineEmits<{ save: [] }>();

const SAVE_BTN = "btn-primary !min-h-9 min-w-9 gap-1.5 !px-2 !text-sm sm:!px-3";
const SAVED_BTN = "btn-secondary !min-h-9 min-w-9 gap-1.5 !px-2 !text-sm sm:!px-3";

const examples = computed<TranslateExample[]>(() =>
  props.item.exampleTarget ? [{ target: props.item.exampleTarget, native: props.item.exampleNative, context: "" }] : [],
);
</script>

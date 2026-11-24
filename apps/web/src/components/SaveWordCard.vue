<template>
  <WordCard as="li" :flat="nested" :padding="nested ? 'sm' : 'md'" :class="nested && 'rounded-xl bg-surface-muted'">
    <WordHeadline class="pt-2" :size="headlineSizeFor(word)" :text="word" :emoji="emoji" />

    <!-- Same place and shape as the translate card's save. -->
    <template #aside>
      <SaveButton :saved="saved" :disabled="saving" @click="emit('save')" />
    </template>

    <template #body>
      <TranslationLines v-if="translation" :lines="[{ lang: nativeLang, text: translation }]" size="xl" />
      <p v-if="note" class="text-base text-ink-muted">{{ note }}</p>
      <ExampleList :examples="examples" />
    </template>
  </WordCard>
</template>

<script setup lang="ts">
import { t } from "../lib/i18n";
import type { TranslateExample } from "../lib/types";
import { headlineSizeFor } from "../lib/word-card";
import ExampleList from "./ExampleList.vue";
import SaveButton from "./SaveButton.vue";
import TranslationLines from "./word/TranslationLines.vue";
import WordCard from "./word/WordCard.vue";
import WordHeadline from "./word/WordHeadline.vue";

/** `nested`: a list inside another card (an article or a video) — a soft tile instead of a second card frame. */
defineProps<{
  word: string;
  emoji: string | null;
  translation: string | null;
  nativeLang: string;
  note?: string | null;
  examples: TranslateExample[];
  saved: boolean;
  saving?: boolean;
  nested?: boolean;
}>();
const emit = defineEmits<{ save: [] }>();

</script>

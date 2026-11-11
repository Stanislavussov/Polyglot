<template>
  <BottomSheet :open="entryId !== null" @close="emit('close')">
    <!-- Same order as the dictionary card: language and sound, then the word, a line, the translations. -->
    <template #header>
      <div class="flex min-w-0 items-center gap-2">
        <DialogTitle class="sr-only">{{ headword }}</DialogTitle>
        <LangBadge v-if="sourceLang" :code="sourceLang" />
        <SpeakButton
          v-if="entryId !== null && sourceLang && audio !== 'off' && fallback?.speakable"
          :entry-id="entryId"
          :lang="sourceLang"
          :text="headword"
          :access="audio"
          @notice="(key) => (notice = key)"
        />
      </div>
    </template>
    <p v-if="notice" role="status" class="mb-4 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">{{ t(notice) }}</p>
    <EntryDetail :entry="entry" :fallback="fallback" :failed="failed" @retry="load" />
  </BottomSheet>
</template>

<script setup lang="ts">
import { DialogTitle } from "reka-ui";
import { computed, ref, watch } from "vue";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import type { AudioAccess, DictionaryItem, EntryDetail as EntryDetailData } from "../lib/types";
import LangBadge from "./LangBadge.vue";
import SpeakButton from "./SpeakButton.vue";
import BottomSheet from "./BottomSheet.vue";
import EntryDetail from "./EntryDetail.vue";

const props = defineProps<{ entryId: number | null; fallback: DictionaryItem | null; audio: AudioAccess }>();
const emit = defineEmits<{ close: [] }>();

const entry = ref<EntryDetailData | null>(null);

const failed = ref(false);
const notice = ref<string | null>(null);

const sourceLang = computed(() => entry.value?.sourceLang ?? props.fallback?.sourceLang ?? "");
const headword = computed(() => entry.value?.sourceUsage?.headword ?? entry.value?.original ?? props.fallback?.original ?? "");

// A slow response for a sheet the learner already closed must not fill the next one.
let requestId = 0;

async function load(): Promise<void> {
  const id = props.entryId;
  if (id === null) return;
  const current = ++requestId;
  failed.value = false;
  try {
    const next = await api.entry(id);
    if (current === requestId) entry.value = next;
  } catch {
    if (current === requestId) failed.value = true;
  }
}

watch(
  () => props.entryId,
  (id) => {
    requestId++;
    // On close keep the card's content: the sheet is still animating out, and
    // clearing it shrank the sheet mid-exit, so it dropped and blinked.
    if (id === null) return;
    entry.value = null;
    failed.value = false;
    notice.value = null;
    void load();
  },
);
</script>

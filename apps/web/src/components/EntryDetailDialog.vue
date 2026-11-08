<template>
  <BottomSheet :open="entryId !== null" @close="emit('close')">
    <template #title>
      <span v-if="entry?.emoji ?? fallback?.emoji" class="mr-2" aria-hidden="true">{{ entry?.emoji ?? fallback?.emoji }}</span>{{ entry?.sourceUsage?.headword ?? entry?.original ?? fallback?.original }}
    </template>
    <EntryDetail :entry="entry" :failed="failed" @retry="load" />
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { api } from "../lib/api";
import type { DictionaryItem, EntryDetail as EntryDetailData } from "../lib/types";
import BottomSheet from "./BottomSheet.vue";
import EntryDetail from "./EntryDetail.vue";

const props = defineProps<{ entryId: number | null; fallback: DictionaryItem | null }>();
const emit = defineEmits<{ close: [] }>();

const entry = ref<EntryDetailData | null>(null);

const failed = ref(false);

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
    void load();
  },
);
</script>

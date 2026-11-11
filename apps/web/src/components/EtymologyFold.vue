<template>
  <!-- One control for every word: a saved story opens at once, a missing one is fetched (and kept) on first open. -->
  <details class="group" @toggle="onToggle">
    <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink">
      <History class="size-4" aria-hidden="true" />{{ t("web.dictionary.askEtymology") }}
      <ChevronDown class="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <MonsterLoader v-if="busy" inline :label="t('web.ask.etymologyLoading')" />
    <p v-else-if="text" class="whitespace-pre-line pb-1 text-base">{{ text }}</p>
    <p v-else-if="errorKey" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t(errorKey) }}</p>
  </details>
</template>

<script setup lang="ts">
import { ChevronDown, History } from "lucide-vue-next";
import { ref } from "vue";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import MonsterLoader from "./MonsterLoader.vue";

const props = defineProps<{ entryId: number; saved: string | null }>();

const text = ref<string | null>(props.saved);
const busy = ref(false);
const errorKey = ref<string | null>(null);

async function onToggle(event: Event): Promise<void> {
  if (!(event.target as HTMLDetailsElement).open || text.value || busy.value) return;
  busy.value = true;
  errorKey.value = null;
  try {
    text.value = (await api.entryEtymology(props.entryId)).etymology;
  } catch (error) {
    errorKey.value = error instanceof ApiError && error.code === "feature_locked" ? "web.explore.lockedHint" : "web.common.error";
  } finally {
    busy.value = false;
  }
}
</script>

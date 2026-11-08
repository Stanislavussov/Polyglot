<template>
  <button
    type="button"
    class="btn-secondary !px-3"
    :aria-label="t('web.audio.listenLabel', { text })"
    :title="access === 'locked' ? t('web.audio.locked') : t('web.audio.listen')"
    :aria-busy="loading"
    @click="play"
  >
    <Lock v-if="access === 'locked'" class="size-4" aria-hidden="true" />
    <LoaderCircle v-else-if="loading" class="size-4 animate-spin" aria-hidden="true" />
    <Volume2 v-else class="size-4" aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { LoaderCircle, Lock, Volume2 } from "lucide-vue-next";
import { ref } from "vue";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import type { AudioAccess } from "../lib/types";

const props = defineProps<{ entryId: number; lang: string; text: string; access: AudioAccess }>();
/** A message key for the card to show; the button itself has no room for text. */
const emit = defineEmits<{ notice: [key: string] }>();

// Replaying a word must not pay for synthesis again: each button fetches its audio once.
const urls = new Map<string, string>();

const loading = ref(false);

async function audioUrl(): Promise<string> {
  const key = `${props.entryId}:${props.lang}`;
  const known = urls.get(key);
  if (known) return known;
  const url = URL.createObjectURL(await api.audio(props.entryId, props.lang));
  urls.set(key, url);
  return url;
}

function noticeFor(error: unknown): string {
  if (error instanceof ApiError && error.code === "locked") return "web.audio.locked";
  if (error instanceof ApiError && error.code === "too_long") return "web.audio.tooLong";
  return "web.audio.failed";
}

async function play(): Promise<void> {
  if (props.access === "locked") {
    emit("notice", "web.audio.locked");
    return;
  }
  if (loading.value) return;
  loading.value = true;
  try {
    await new Audio(await audioUrl()).play();
  } catch (error) {
    emit("notice", noticeFor(error));
  } finally {
    loading.value = false;
  }
}
</script>

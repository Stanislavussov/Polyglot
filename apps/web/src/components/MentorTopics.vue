<template>
  <section class="space-y-2">
    <h2 class="text-sm font-semibold text-ink-muted">{{ t("web.learn.mentor.history") }}</h2>
    <ul class="space-y-1">
      <li v-for="thread in threads" :key="thread.id">
        <button type="button" class="w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-muted" @click="emit('open', thread)">
          {{ thread.title }}
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { t } from "../lib/i18n";
import type { MentorThread } from "../lib/mentor-threads";

defineProps<{ threads: MentorThread[] }>();
const emit = defineEmits<{ open: [thread: MentorThread] }>();
</script>

<template>
  <ul class="space-y-2" aria-live="polite">
    <li
      v-for="(turn, index) in turns"
      :key="index"
      :class="turn.role === 'user' ? 'ml-8 bg-primary-soft text-primary-soft-fg' : 'mr-8 bg-surface-muted'"
      class="whitespace-pre-line break-words rounded-xl px-4 py-3 text-base"
    >
      <!-- Safe: mentorHtml escapes everything but bare <b>/<i>. -->
      <span v-if="turn.role === 'assistant'" v-html="mentorHtml(turn.content)" />
      <span v-else>{{ turn.content }}</span>
    </li>
    <li v-if="pending" class="ml-8 whitespace-pre-line break-words rounded-xl bg-primary-soft px-4 py-3 text-base text-primary-soft-fg">
      {{ pending }}
    </li>
    <li v-if="busy" class="mr-8 rounded-xl bg-surface-muted px-4 py-3 text-base text-ink-muted" role="status">
      {{ t("web.explore.thinking") }}
    </li>
  </ul>
</template>

<script setup lang="ts">
import { t } from "../lib/i18n";
import { mentorHtml } from "../lib/mentor-html";
import type { MentorTurn } from "../lib/types";

defineProps<{ turns: MentorTurn[]; busy: boolean; pending?: string | null }>();
</script>

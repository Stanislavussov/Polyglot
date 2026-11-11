<template>
  <IconRow>
    <template v-if="emoji || reserveIcon" #icon>
      <span :class="HEADLINE_EMOJI[size]" aria-hidden="true">{{ emoji }}</span>
    </template>
    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <component :is="as" :class="['min-w-0 break-words', HEADLINE_TEXT[size], TONE[tone]]">{{ text }}</component>
      <slot name="after" />
    </div>
  </IconRow>
</template>

<script setup lang="ts">
import { HEADLINE_EMOJI, HEADLINE_TEXT, type HeadlineSize, TONE, type Tone } from "../../lib/word-card";
import IconRow from "./IconRow.vue";

withDefaults(
  defineProps<{
    text: string;
    emoji?: string | null;
    size?: HeadlineSize;
    tone?: Tone;
    as?: string;
    /** Keep the icon column even without an emoji, so a list of headlines lines up. */
    reserveIcon?: boolean;
  }>(),
  { emoji: null, size: "md", tone: "ink", as: "p", reserveIcon: false },
);
</script>

<template>
  <IconRow :class="variant === 'chip' && CHIP">
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
    /** `chip` sets the word on a soft tile that hugs the text and wraps a sentence inside it. */
    variant?: "plain" | "chip";
  }>(),
  { emoji: null, size: "md", tone: "ink", as: "p", reserveIcon: false, variant: "plain" },
);

// Negative margin = padding, so the emoji stays in the same column as the flags around it.
const CHIP = "-mx-2 w-fit max-w-[calc(100%+1rem)] rounded-xl bg-primary-soft px-2 py-1.5";
</script>

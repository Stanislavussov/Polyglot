<template>
  <IconRow :class="variant === 'chip' && CHIP">
    <template v-if="emoji || reserveIcon" #icon>
      <span :class="HEADLINE_EMOJI[size]" aria-hidden="true">{{ emoji }}</span>
    </template>
    <!-- Inline flow, not a flex row: a block heading spans the full width once a phrase wraps,
         pushing the speaker onto its own line. The word joiner glues it to the last word. -->
    <div :class="['min-w-0 break-words', HEADLINE_TEXT[size]]">
      <component :is="as" :class="['inline', TONE[tone]]"><StreamText v-if="stream" :text="text" /><template v-else>{{ text }}</template></component><template v-if="$slots.after">{{ WORD_JOINER }}<span class="ml-2 inline-flex -my-1 items-center gap-2 align-middle"><slot name="after" /></span></template>
    </div>
  </IconRow>
</template>

<script setup lang="ts">
import { HEADLINE_EMOJI, HEADLINE_TEXT, type HeadlineSize, TONE, type Tone } from "../../lib/word-card";
import StreamText from "../StreamText.vue";
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
    /** Type the text out as it arrives (the translate card). */
    stream?: boolean;
  }>(),
  { emoji: null, size: "md", tone: "ink", as: "p", reserveIcon: false, variant: "plain", stream: false },
);

// Negative margin = padding, so the emoji stays in the same column as the flags around it.
const WORD_JOINER = "\u2060";
const CHIP = "-mx-2 w-fit max-w-[calc(100%+1rem)] rounded-xl bg-primary-soft px-2 py-1.5";
</script>

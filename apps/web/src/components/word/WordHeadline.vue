<template>
  <IconRow :class="variant === 'chip' && CHIP">
    <template v-if="emoji || reserveIcon" #icon>
      <span :class="HEADLINE_EMOJI[size]" aria-hidden="true">{{ emoji }}</span>
    </template>
    <div :class="['min-w-0 break-words', HEADLINE_TEXT[size]]">
      <component :is="as" v-if="!$slots.after" :class="['inline', TONE[tone]]"><StreamText v-if="stream" :text="text" /><template v-else>{{ text }}</template></component>
      <!-- The last word and the speaker form one unbreakable box: a word joiner alone did not keep them
           together in Safari, which wrapped the button under a word that filled the line. -->
      <component :is="as" v-else :class="TONE[tone]" :style="scale === 1 ? undefined : { fontSize: `${scale}em` }"
        >{{ parts.lead }}<span ref="group" :class="['inline-flex max-w-full align-top', broken ? 'items-end' : 'items-center']"
          ><span ref="tail" :class="['min-w-0', broken ? 'break-words' : 'whitespace-nowrap']">{{ parts.tail }}</span
          ><span class="ml-2 flex shrink-0 -my-1 items-center gap-2"><slot name="after" /></span></span
      ></component>
    </div>
  </IconRow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { headlineScale, splitLastWord } from "../../lib/headline-fit";
import { HEADLINE_EMOJI, HEADLINE_TEXT, type HeadlineSize, TONE, type Tone } from "../../lib/word-card";
import StreamText from "../StreamText.vue";
import IconRow from "./IconRow.vue";

const props = withDefaults(
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

const parts = computed(() => splitLastWord(props.text));
const group = ref<HTMLElement | null>(null);
const tail = ref<HTMLElement | null>(null);
const scale = ref(1);
const broken = ref(false);

// Text width scales with the font while the button does not, so one measurement at full size
// gives the exact scale that fits the word beside it.
async function fit(): Promise<void> {
  scale.value = 1;
  broken.value = false;
  await nextTick();
  const word = tail.value;
  if (!word) return;
  const next = headlineScale(word.clientWidth, word.scrollWidth);
  if (next === null) broken.value = true;
  else scale.value = next;
}

let observer: ResizeObserver | null = null;
let lastWidth = 0;
onMounted(() => {
  if (!group.value) return;
  void fit();
  const box = group.value.parentElement?.parentElement;
  if (!box || typeof ResizeObserver === "undefined") return;
  // Only a width change can change the fit; reacting to height would loop on our own resize.
  observer = new ResizeObserver(([entry]) => {
    const width = entry?.contentRect.width ?? 0;
    if (width === lastWidth) return;
    lastWidth = width;
    void fit();
  });
  observer.observe(box);
});
onBeforeUnmount(() => observer?.disconnect());
watch(() => props.text, () => void fit());

const CHIP = "-mx-2 w-fit max-w-[calc(100%+1rem)] rounded-xl bg-primary-soft px-2 py-1.5";
</script>

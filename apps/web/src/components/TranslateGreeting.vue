<template>
  <!-- An empty page greets instead of sitting blank; the phrase changes per visit and with the time of day.
       Desktop sets it in one line above the box, as chat apps do. Phones keep it out of the page flow (in the flow it made an
       empty page scrollable) and centre it in what is visible above the bottom panel, keyboard up or down. -->
  <div
    :class="
      inline
        ? 'flex items-center justify-center gap-3 pb-8 pt-[12vh] text-center'
        : 'pointer-events-none fixed inset-x-0 top-0 flex flex-col items-center gap-4 px-4 text-center will-change-transform'
    "
    :style="inline ? undefined : { transform: `translate3d(0, calc(${center}px - 50%), 0)` }"
  >
    <MonsterMark :class="inline ? 'size-10' : 'size-14'" />
    <p :class="['font-semibold text-ink', inline ? 'text-3xl' : 'text-2xl']">{{ t(phrase) }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { t } from "../lib/i18n";
import { dockHeight, freeAreaCenter, visibleBox } from "../lib/mobile-dock";
import { pickGreeting } from "../lib/translate-greeting";
import MonsterMark from "./MonsterMark.vue";

defineProps<{ inline?: boolean }>();

const phrase = pickGreeting(new Date().getHours(), Math.random());

// The phone header (h-14): the greeting centres below it until the keyboard pans it out of sight.
const HEADER_PX = 56;
const center = computed(() => freeAreaCenter(visibleBox.value.top, visibleBox.value.height, HEADER_PX, dockHeight.value));
</script>

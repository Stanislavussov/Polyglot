<template>
  <!-- An empty page greets instead of sitting blank; the phrase changes per visit and with the time of day.
       Desktop sets it in one line above the box, as chat apps do. Phones pin it in the middle of the screen out of the
       page flow: in the flow it made an empty page scrollable, and svh (not dvh) keeps it still when the keyboard opens. -->
  <div
    :class="
      inline
        ? 'flex items-center justify-center gap-3 pb-8 pt-[12vh] text-center'
        : 'pointer-events-none fixed inset-x-0 top-[44svh] flex -translate-y-1/2 flex-col items-center gap-4 px-4 text-center'
    "
  >
    <MonsterMark :class="inline ? 'size-10' : 'size-14'" />
    <p :class="['font-semibold text-ink', inline ? 'text-3xl' : 'text-2xl']">{{ t(phrase) }}</p>
  </div>
</template>

<script setup lang="ts">
import { t } from "../lib/i18n";
import { pickGreeting } from "../lib/translate-greeting";
import MonsterMark from "./MonsterMark.vue";

defineProps<{ inline?: boolean }>();

const phrase = pickGreeting(new Date().getHours(), Math.random());
</script>

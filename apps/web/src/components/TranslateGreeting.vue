<template>
  <!-- An empty page greets instead of sitting blank; the phrase changes per visit and with the time of day.
       Phones stack it in the free space above the bottom box; desktop sets it in one line above the box, as chat apps do. -->
  <div
    :class="
      inline
        ? 'flex items-center justify-center gap-3 pb-8 pt-[12vh] text-center'
        : 'flex min-h-[45dvh] flex-col items-center justify-center gap-4 py-10 text-center'
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

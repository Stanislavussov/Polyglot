<template>
  <!-- An empty page greets instead of sitting blank; the phrase changes per visit and with the time of day.
       Desktop sets it in one line above the box, flush with where the box's text starts (pl-5 = its border, p-3 and px-2):
       centred, it floated off-axis because history takes the right column. Phones stack it under the box, at the top of the page. -->
  <div :class="inline ? 'flex items-center gap-3 pb-8 pl-5 pt-[12vh] text-left' : 'flex flex-col items-center gap-4 pt-[8vh] text-center'">
    <MonsterMark :class="inline ? 'size-10' : 'size-14'" />
    <p :class="['font-semibold text-ink', inline ? 'text-3xl' : 'text-2xl']">{{ t(mentor ? "web.translate.greet.mentor" : phrase) }}</p>
  </div>
</template>

<script setup lang="ts">
import { t } from "../lib/i18n";
import { pickGreeting } from "../lib/translate-greeting";
import MonsterMark from "./MonsterMark.vue";

defineProps<{ inline?: boolean; mentor?: boolean }>();

const phrase = pickGreeting(new Date().getHours(), Math.random());
</script>

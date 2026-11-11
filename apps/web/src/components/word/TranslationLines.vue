<template>
  <ul :class="['space-y-1', LINE_TEXT[size]]">
    <li v-for="line in lines" :key="line.lang">
      <IconRow>
        <template #icon><LangFlag class="mt-[0.2em]" :code="line.lang" /></template>
        <span class="break-words">{{ line.text }}</span>
      </IconRow>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { LINE_TEXT, type LineSize } from "../../lib/word-card";
import LangFlag from "../LangFlag.vue";
import IconRow from "./IconRow.vue";

withDefaults(defineProps<{ lines: { lang: string; text: string }[]; size?: LineSize }>(), { size: "base" });
</script>

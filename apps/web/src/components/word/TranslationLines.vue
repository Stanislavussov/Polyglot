<template>
  <ul :class="['space-y-1', LINE_TEXT[size]]">
    <li v-for="line in lines" :key="line.lang">
      <IconRow>
        <template #icon><LangFlag class="mt-[0.3em] !size-4" :code="line.lang" /></template>
        <!-- The speaker flows after the last word, so a wrapped line keeps it beside the text. -->
        <p class="break-words">{{ line.text }}<span v-if="$slots.after" class="ml-2 inline-block align-middle"><slot name="after" :line="line" /></span></p>
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

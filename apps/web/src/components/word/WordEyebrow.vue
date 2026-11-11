<template>
  <IconRow align="center">
    <template v-if="flag" #icon><LangFlag class="!size-4" :code="code" /></template>
    <p :class="['text-sm font-medium uppercase tracking-wider', TONE[tone]]">
      <slot>{{ label ?? languageName(code) }}</slot>
    </p>
  </IconRow>
</template>

<script setup lang="ts">
import { languageName } from "../../lib/settings-store";
import { TONE, type Tone } from "../../lib/word-card";
import LangFlag from "../LangFlag.vue";
import IconRow from "./IconRow.vue";

withDefaults(defineProps<{ code: string; label?: string; flag?: boolean; tone?: Tone }>(), { flag: true, tone: "muted" });
</script>

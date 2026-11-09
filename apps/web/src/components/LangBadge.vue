<template>
  <span class="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-muted py-0.5 pl-0.5 pr-2.5 align-middle text-sm font-medium text-ink">
    <LangFlag :code="code" /><span class="truncate">{{ label ?? languageName(code) }}</span>
  </span>
</template>

<script setup lang="ts">
import { languageName } from "../lib/settings-store";
import LangFlag from "./LangFlag.vue";

defineProps<{ code: string; label?: string }>();
</script>

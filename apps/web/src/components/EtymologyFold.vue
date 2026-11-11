<template>
  <!-- Folded by default: the card stays short; the story is one tap away. -->
  <details class="group" :open="open">
    <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink">
      <History class="size-4" aria-hidden="true" />{{ t("web.dictionary.askEtymology") }}
      <ChevronDown class="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <p class="whitespace-pre-line pb-1 text-base">{{ text }}</p>
  </details>
</template>

<script setup lang="ts">
import { ChevronDown, History } from "lucide-vue-next";
import { t } from "../lib/i18n";

defineProps<{ text: string; open?: boolean }>();
</script>

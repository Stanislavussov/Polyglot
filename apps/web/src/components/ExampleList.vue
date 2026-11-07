<template>
  <ul v-if="examples.length > 0" class="space-y-2 text-sm">
    <li v-for="example in examples" :key="example.target" class="border-l-2 border-line pl-3">
      <p class="font-medium">{{ example.target }}</p>
      <p v-if="example.native" class="text-ink-muted">{{ example.native }}</p>
      <p v-if="example.context" class="text-xs text-ink-muted opacity-80">{{ example.context }}</p>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { TranslateExample } from "../lib/types";

defineProps<{ examples: TranslateExample[] }>();
</script>

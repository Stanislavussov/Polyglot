<template>
  <ul v-if="examples.length > 0" class="space-y-2.5 text-base">
    <li v-for="example in examples" :key="example.target" class="border-l-2 border-line pl-3" :class="{ 'stream-in': stream }">
      <p class="font-medium"><StreamText v-if="stream" :text="example.target" /><template v-else>{{ example.target }}</template></p>
      <p v-if="example.native" class="text-ink-muted"><StreamText v-if="stream" :text="example.native" /><template v-else>{{ example.native }}</template></p>
      <p v-if="example.context" class="text-sm text-ink-muted opacity-80">{{ example.context }}</p>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { TranslateExample } from "../lib/types";
import StreamText from "./StreamText.vue";

/** `stream`: the translate card types examples out as they arrive. */
defineProps<{ examples: TranslateExample[]; stream?: boolean }>();
</script>

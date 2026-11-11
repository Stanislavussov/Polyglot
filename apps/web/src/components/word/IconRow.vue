<template>
  <div :class="['flex min-w-0 gap-3', align === 'center' ? 'items-center' : 'items-start']">
    <span v-if="$slots.icon" :class="['grid shrink-0 place-items-center', ICON_COLUMN[column]]">
      <slot name="icon" />
    </span>
    <div class="min-w-0 flex-1">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { ICON_COLUMN, ICON_COLUMN_KEY, type IconColumn } from "../../lib/word-card";

const props = defineProps<{ align?: "start" | "center"; iconColumn?: IconColumn }>();

const injected = inject(ICON_COLUMN_KEY, ref<IconColumn>("md"));
const column = computed(() => props.iconColumn ?? injected.value);
</script>

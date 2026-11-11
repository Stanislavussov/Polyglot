<template>
  <component :is="as" :class="[!flat && 'card', PADDING[padding]]">
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1 space-y-1">
        <slot />
      </div>
      <div v-if="$slots.aside" class="-mr-2 -mt-1 flex shrink-0 items-center gap-2">
        <slot name="aside" />
      </div>
    </div>
    <div v-if="$slots.body" class="mt-2 space-y-2">
      <slot name="body" />
    </div>
    <div v-if="$slots.footer" class="mt-3">
      <slot name="footer" />
    </div>
  </component>
</template>

<script setup lang="ts">
import { provide, toRef } from "vue";
import { ICON_COLUMN_KEY, type IconColumn } from "../../lib/word-card";

const props = withDefaults(
  defineProps<{
    as?: string;
    /** No card chrome: for a section inside another card or dialog. */
    flat?: boolean;
    padding?: "none" | "sm" | "md";
    iconColumn?: IconColumn;
  }>(),
  { as: "div", flat: false, padding: "sm", iconColumn: "md" },
);

const PADDING = { none: "", sm: "!p-4", md: "!p-6" } as const;

provide(ICON_COLUMN_KEY, toRef(props, "iconColumn"));
</script>

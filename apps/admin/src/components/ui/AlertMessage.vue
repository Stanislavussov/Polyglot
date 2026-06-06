<template>
  <div :class="cn(alertVariants({ tone: resolvedTone }), props.class)">
    <template v-if="message">{{ message }}</template>
    <slot v-else />
  </div>
</template>

<script setup lang="ts">
import { cva } from "class-variance-authority";
import { computed, type HTMLAttributes } from "vue";
import { cn } from "../../lib/utils";

type AlertTone = "error" | "success" | "muted" | "info";

const alertVariants = cva("rounded-md px-3 py-2 text-sm", {
  variants: {
    tone: {
      error: "bg-red-50 text-red-700",
      success: "bg-emerald-50 text-emerald-700",
      muted: "bg-gray-50 text-gray-500",
      info: "bg-blue-50 text-blue-700",
    },
  },
  defaultVariants: {
    tone: "error",
  },
});

const props = withDefaults(
  defineProps<{
    tone?: AlertTone;
    type?: AlertTone;
    message?: string;
    class?: HTMLAttributes["class"];
  }>(),
  {
    tone: "error",
    type: undefined,
    message: undefined,
    class: undefined,
  },
);

const resolvedTone = computed(() => props.type ?? props.tone);
</script>

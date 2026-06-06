<template>
  <button
    :type="type"
    :disabled="disabled"
    :class="cn(buttonVariants({ variant }), props.class)"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { cva } from "class-variance-authority";
import type { HTMLAttributes } from "vue";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500",
        secondary: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-indigo-500",
        danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
        link: "px-0 py-0 text-indigo-600 shadow-none hover:text-indigo-800 focus:ring-indigo-500",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  },
);

const props = withDefaults(
  defineProps<{
    type?: "button" | "submit";
    variant?: "primary" | "secondary" | "danger" | "link";
    disabled?: boolean;
    class?: HTMLAttributes["class"];
  }>(),
  {
    type: "button",
    variant: "primary",
    disabled: false,
    class: undefined,
  },
);
</script>

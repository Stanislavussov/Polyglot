<template>
  <div class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
    <div class="flex items-center gap-3">
      <div
        class="flex h-10 w-10 items-center justify-center rounded-lg"
        :class="iconBgClass"
      >
        <span class="text-lg" v-html="icon" />
      </div>
      <div>
        <p class="text-sm font-medium text-gray-600">{{ label }}</p>
        <p class="mt-0.5 text-2xl font-bold tracking-tight text-gray-900">
          {{ displayValue }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    label: string;
    value: number;
    icon?: string;
    iconBgClass?: string;
  }>(),
  {
    icon: "📊",
    iconBgClass: "bg-indigo-50 text-indigo-600",
  },
);

const displayValue = computed(() => {
  if (props.value >= 1_000_000) return `${(props.value / 1_000_000).toFixed(1)}M`;
  if (props.value >= 1_000) return `${(props.value / 1_000).toFixed(1)}K`;
  return String(props.value);
});
</script>
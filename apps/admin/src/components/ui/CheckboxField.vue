<template>
  <label class="flex items-center gap-2 text-sm text-gray-700">
    <input
      :checked="modelValue"
      type="checkbox"
      class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
      @change="emitValue"
    />
    {{ label }}
  </label>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

function emitValue(event: Event): void {
  emit("update:modelValue", (event.target as HTMLInputElement).checked);
}
</script>

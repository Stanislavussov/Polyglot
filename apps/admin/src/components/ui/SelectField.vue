<template>
  <div>
    <label :for="id" class="block text-sm font-medium text-gray-700">{{ label }}</label>
    <select
      :id="id"
      :value="modelValue"
      :name="name ?? id"
      class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      @change="emitValue"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  id: string;
  label: string;
  modelValue: string;
  options: Array<{ value: string; label: string }>;
  name?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

function emitValue(event: Event): void {
  emit("update:modelValue", (event.target as HTMLSelectElement).value);
}
</script>

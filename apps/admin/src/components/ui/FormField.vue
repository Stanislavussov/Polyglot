<template>
  <div>
    <label :for="id" class="block text-sm font-medium text-gray-700">{{ label }}</label>
    <input
      :id="id"
      :name="name ?? id"
      :type="type"
      :value="modelValue"
      :required="required"
      :readonly="readonly"
      :disabled="disabled"
      :autocomplete="autocomplete"
      :placeholder="placeholder"
      :step="step"
      class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 read-only:bg-gray-50"
      @input="emitValue"
    />
    <p v-if="hint" class="mt-1 text-xs text-gray-500">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    id: string;
    label: string;
    modelValue: string | number;
    name?: string;
    type?: "text" | "email" | "password" | "number";
    required?: boolean;
    readonly?: boolean;
    disabled?: boolean;
    autocomplete?: string;
    placeholder?: string;
    step?: string;
    hint?: string;
  }>(),
  {
    type: "text",
    required: false,
    readonly: false,
    disabled: false,
    name: undefined,
    autocomplete: undefined,
    placeholder: undefined,
    step: undefined,
    hint: undefined,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string | number];
}>();

function emitValue(event: Event): void {
  const input = event.target as HTMLInputElement;
  emit("update:modelValue", input.type === "number" ? Number(input.value) : input.value);
}
</script>

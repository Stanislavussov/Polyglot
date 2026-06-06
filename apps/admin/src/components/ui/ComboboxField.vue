<template>
  <div class="relative">
    <label :for="id" class="block text-sm font-medium text-gray-700">{{ label }}</label>
    <div class="relative mt-1">
      <Search class="pointer-events-none absolute left-3 top-2.5 size-4 text-gray-400" />
      <input
        :id="id"
        v-model="query"
        :name="name ?? id"
        :placeholder="placeholder"
        type="text"
        autocomplete="off"
        class="block w-full rounded-md border border-gray-300 py-2 pl-9 pr-9 text-sm shadow-sm transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        @focus="open = true"
        @keydown.escape="open = false"
      />
      <ChevronsUpDown class="pointer-events-none absolute right-3 top-2.5 size-4 text-gray-400" />
    </div>

    <div
      v-if="open"
      class="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
    >
      <p v-if="filteredOptions.length === 0" class="px-3 py-2 text-gray-500">No models found</p>
      <button
        v-for="option in filteredOptions"
        :key="option.value"
        type="button"
        class="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
        @mousedown.prevent="selectOption(option)"
      >
        <Check
          class="mt-0.5 size-4 text-indigo-600"
          :class="{ 'opacity-100': option.value === modelValue, 'opacity-0': option.value !== modelValue }"
        />
        <span class="min-w-0 flex-1">
          <span class="flex min-w-0 items-center justify-between gap-3">
            <span class="truncate font-medium text-gray-900">{{ option.label }}</span>
            <span v-if="option.badge" class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700">
              {{ option.badge }}
            </span>
          </span>
          <span v-if="option.description" class="mt-0.5 block truncate text-xs text-gray-500">{{ option.description }}</span>
          <span v-if="option.details?.length" class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
            <span v-for="detail in option.details" :key="detail.label" class="whitespace-nowrap">
              <span class="font-medium text-gray-500">{{ detail.label }}:</span> {{ detail.value }}
            </span>
          </span>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Check, ChevronsUpDown, Search } from "lucide-vue-next";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  details?: Array<{ label: string; value: string }>;
}

const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    modelValue: string;
    options: ComboboxOption[];
    name?: string;
    placeholder?: string;
  }>(),
  {
    name: undefined,
    placeholder: "Search...",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const open = ref(false);
const query = ref("");

const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue) ?? null);

const filteredOptions = computed(() => {
  const term = query.value.trim().toLowerCase();
  if (!term || selectedOption.value?.label === query.value) {
    return props.options;
  }

  return props.options.filter((option) => {
    const description = option.description ?? "";
    const badge = option.badge ?? "";
    const details = option.details?.map((detail) => `${detail.label} ${detail.value}`).join(" ") ?? "";
    return (
      option.label.toLowerCase().includes(term) ||
      option.value.toLowerCase().includes(term) ||
      description.toLowerCase().includes(term) ||
      badge.toLowerCase().includes(term) ||
      details.toLowerCase().includes(term)
    );
  });
});

function selectOption(option: ComboboxOption): void {
  emit("update:modelValue", option.value);
  query.value = option.label;
  open.value = false;
}

watch(
  selectedOption,
  (option) => {
    query.value = option?.label ?? "";
  },
  { immediate: true },
);
</script>

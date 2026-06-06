<template>
  <form class="space-y-4" @submit.prevent="handleSave">
    <div
      v-for="key in Object.keys(modelValue)"
      :key="key"
      class="grid grid-cols-[180px_1fr] items-start gap-4"
    >
      <label :for="key" class="pt-2 text-sm font-medium text-gray-700 capitalize">
        {{ formatLabel(key) }}
      </label>
      <div class="flex items-center gap-2">
        <input
          :id="key"
          v-model="form[key]"
          :type="inputType(modelValue[key])"
          class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
    </div>
    <div class="flex justify-end pt-2">
      <button
        type="submit"
        :disabled="saving"
        class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {{ saving ? "Saving..." : "Save Changes" }}
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  modelValue: Record<string, string | number | boolean>;
  saveFn: (data: Record<string, string | number | boolean>) => Promise<unknown>;
}>();

const emit = defineEmits<{
  saved: [];
  error: [message: string];
}>();

const form = ref<Record<string, string | number | boolean>>({ ...props.modelValue });
const saving = ref(false);

watch(
  () => props.modelValue,
  (val) => {
    form.value = { ...val };
  },
  { deep: true },
);

function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim();
}

function inputType(value: string | number | boolean): string {
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  return "text";
}

async function handleSave() {
  saving.value = true;
  try {
    await props.saveFn(form.value);
    emit("saved");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save";
    emit("error", message);
  } finally {
    saving.value = false;
  }
}
</script>
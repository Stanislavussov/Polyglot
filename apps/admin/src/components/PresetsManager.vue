<template>
  <div>
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Translation Presets</h1>
        <p class="mt-1 text-sm text-gray-500">Manage translation configuration presets</p>
      </div>
      <button
        class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
        @click="openAdd"
      >
        Add Preset
      </button>
    </div>

    <div class="mt-6">
      <AlertMessage v-if="error">{{ error }}</AlertMessage>
      <p v-else-if="loading" class="text-sm text-gray-400">Loading...</p>
      <p v-else-if="items.length === 0" class="text-sm text-gray-400">No presets configured</p>
      <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table class="min-w-max divide-y divide-gray-200 sm:min-w-full">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Name</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Label</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Fields</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Status</th>
              <th class="px-4 py-3 text-right text-xs font-semibold tracking-wide text-gray-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="preset in items" :key="preset.name" class="transition-colors hover:bg-gray-50">
              <td class="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{{ preset.name }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{{ preset.label }}</td>
              <td class="px-4 py-3 text-sm text-gray-700">
                <div class="flex flex-wrap gap-1">
                  <span
                    v-for="label in configLabels(preset)"
                    :key="label"
                    class="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                  >
                    {{ label }}
                  </span>
                  <span v-if="configLabels(preset).length === 0" class="text-gray-400">None</span>
                </div>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-sm">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="preset.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-800'"
                >
                  {{ preset.isActive ? "Active" : "Inactive" }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right text-sm space-x-2">
                <AppButton variant="link" class="text-gray-600 hover:text-gray-800" @click="openEdit(preset)">Edit</AppButton>
                <AppButton variant="link" class="text-red-600 hover:text-red-800" @click="deletingName = preset.name">
                  Delete
                </AppButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <AppModal v-if="showForm" size="lg" @close="closeForm">
        <h2 class="text-lg font-semibold text-gray-900">{{ editingName ? "Edit Preset" : "Add Preset" }}</h2>
        <form class="mt-4 space-y-4" @submit.prevent="save">
          <FormField id="p-name" v-model="form.name" label="Name" name="name" required :readonly="editingName !== null" />
          <FormField id="p-label" v-model="form.label" label="Label" name="label" required />
          <fieldset class="space-y-2">
            <legend class="text-sm font-medium text-gray-700">Output Fields</legend>
            <CheckboxField
              v-for="field in configFields"
              :key="field.key"
                v-model="form.config[field.key]"
              :label="field.label"
            />
          </fieldset>
          <CheckboxField v-model="form.isActive" label="Active" />
          <AlertMessage v-if="formError">{{ formError }}</AlertMessage>
          <div class="flex justify-end gap-3 pt-2">
            <AppButton variant="secondary" @click="closeForm">
              Cancel
            </AppButton>
            <AppButton type="submit">
              Save
            </AppButton>
          </div>
        </form>
    </AppModal>

    <AppModal v-if="deletingName" @close="deletingName = null">
        <h3 class="text-lg font-semibold text-gray-900">Delete Preset</h3>
        <p class="mt-2 text-sm text-gray-600">Are you sure you want to delete this preset? This action cannot be undone.</p>
        <div class="mt-6 flex justify-end gap-3">
          <AppButton variant="secondary" @click="deletingName = null">
            Cancel
          </AppButton>
          <AppButton variant="danger" @click="deletePreset">
            Delete
          </AppButton>
        </div>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { type Preset, presets } from "../lib/api";
import { presetCreateSchema, presetUpdateSchema, zodErrorMessage } from "../lib/validation";
import AlertMessage from "./ui/AlertMessage.vue";
import AppButton from "./ui/AppButton.vue";
import AppModal from "./ui/AppModal.vue";
import CheckboxField from "./ui/CheckboxField.vue";
import FormField from "./ui/FormField.vue";

type PresetConfigKey = keyof Preset["config"];
type PresetForm = Preset;

const configFields: Array<{ key: PresetConfigKey; label: string }> = [
  { key: "transcription", label: "Transcription" },
  { key: "synonyms", label: "Synonyms" },
  { key: "examples", label: "Examples" },
  { key: "alternatives", label: "Alternatives" },
  { key: "equivalentNote", label: "Equivalent note" },
  { key: "connotationWarning", label: "Connotation warning" },
];

const emptyForm = (): PresetForm => ({
  name: "",
  label: "",
  config: {
    transcription: false,
    synonyms: false,
    examples: false,
    alternatives: false,
    equivalentNote: false,
    connotationWarning: false,
  },
  isActive: true,
});

const items = ref<Preset[]>([]);
const loading = ref(false);
const error = ref("");
const showForm = ref(false);
const editingName = ref<string | null>(null);
const deletingName = ref<string | null>(null);
const formError = ref("");
const form = reactive<PresetForm>(emptyForm());

function resetForm(preset?: Preset): void {
  Object.assign(form, preset ? { ...preset, config: { ...preset.config } } : emptyForm());
}

async function loadPresets(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    items.value = await presets.list();
  } catch {
    error.value = "Failed to load presets";
  } finally {
    loading.value = false;
  }
}

function configLabels(preset: Preset): string[] {
  const labels: string[] = [];
  for (const field of configFields) {
    if (preset.config[field.key]) labels.push(field.label);
  }
  return labels;
}

function openAdd(): void {
  editingName.value = null;
  formError.value = "";
  resetForm();
  showForm.value = true;
}

function openEdit(preset: Preset): void {
  editingName.value = preset.name;
  formError.value = "";
  resetForm(preset);
  showForm.value = true;
}

function closeForm(): void {
  showForm.value = false;
  formError.value = "";
}

async function save(): Promise<void> {
  formError.value = "";
  try {
    if (editingName.value) {
      const parsed = presetUpdateSchema.safeParse({
        label: form.label,
        config: { ...form.config },
        isActive: form.isActive,
      });
      if (!parsed.success) {
        formError.value = zodErrorMessage(parsed.error);
        return;
      }
      await presets.update(editingName.value, parsed.data);
    } else {
      const parsed = presetCreateSchema.safeParse({ ...form, config: { ...form.config } });
      if (!parsed.success) {
        formError.value = zodErrorMessage(parsed.error);
        return;
      }
      await presets.create(parsed.data);
    }
    closeForm();
    await loadPresets();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "Failed to save";
  }
}

async function deletePreset(): Promise<void> {
  if (!deletingName.value) return;
  try {
    await presets.delete(deletingName.value);
    deletingName.value = null;
    await loadPresets();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to delete";
  }
}

onMounted(() => {
  void loadPresets();
});
</script>

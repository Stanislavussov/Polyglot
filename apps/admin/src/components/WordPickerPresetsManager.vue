<template>
  <div>
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Word Picker</h1>
        <p class="mt-1 text-sm text-gray-500">
          Angles offered under “✨ Pick words” in the bot. The prompt is what the model is told to look for.
        </p>
      </div>
      <button
        class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
        @click="openAdd"
      >
        Add Angle
      </button>
    </div>

    <div class="mt-6">
      <AlertMessage v-if="error">{{ error }}</AlertMessage>
      <p v-else-if="loading" class="text-sm text-gray-400">Loading...</p>
      <p v-else-if="items.length === 0" class="text-sm text-gray-400">No angles configured</p>
      <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table class="min-w-max divide-y divide-gray-200 sm:min-w-full">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Order</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Angle</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Slug</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Languages</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Titles</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Status</th>
              <th class="px-4 py-3 text-right text-xs font-semibold tracking-wide text-gray-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="preset in items" :key="preset.id" class="transition-colors hover:bg-gray-50">
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{{ preset.sortOrder }}</td>
              <td class="px-4 py-3 text-sm">
                <div class="font-medium text-gray-900">{{ preset.emoji }} {{ preset.title }}</div>
                <div class="mt-0.5 max-w-md truncate text-xs text-gray-500">{{ preset.prompt }}</div>
              </td>
              <td class="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">{{ preset.slug }}</td>
              <td class="px-4 py-3 text-sm text-gray-700">
                <span v-if="preset.learningLangs.length === 0" class="text-gray-400">All</span>
                <span v-else>{{ preset.learningLangs.join(", ") }}</span>
              </td>
              <td class="px-4 py-3 text-sm text-gray-700">
                <span v-if="translatedCodes(preset).length === 0" class="text-gray-400">—</span>
                <span v-else class="text-xs">{{ translatedCodes(preset).join(", ") }}</span>
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
                <AppButton variant="link" class="text-red-600 hover:text-red-800" @click="deletingId = preset.id">
                  Delete
                </AppButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <AppModal v-if="showForm" size="lg" @close="closeForm">
      <h2 class="text-lg font-semibold text-gray-900">{{ editingId ? "Edit Angle" : "Add Angle" }}</h2>
      <form class="mt-4 space-y-4" @submit.prevent="save">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField
            id="wp-slug"
            v-model="form.slug"
            label="Slug"
            name="slug"
            required
            :readonly="editingId !== null"
            hint="Stable key, never shown to users"
          />
          <FormField id="wp-emoji" v-model="form.emoji" label="Emoji" name="emoji" required />
          <FormField id="wp-order" v-model="form.sortOrder" label="Order" name="sortOrder" type="number" />
        </div>

        <FormField id="wp-title" v-model="form.title" label="Title" name="title" required hint="Shown when the user's language has no translation below" />

        <div>
          <label for="wp-prompt" class="block text-sm font-medium text-gray-700">Prompt</label>
          <textarea
            id="wp-prompt"
            v-model="form.prompt"
            rows="6"
            required
            class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Pick words that…"
          ></textarea>
          <p class="mt-1 text-xs text-gray-500">
            Written for the model, in English. Say what belongs in the set and what each item's note should reveal.
          </p>
        </div>

        <FormField
          id="wp-langs"
          v-model="learningLangsText"
          label="Learning languages"
          name="learningLangs"
          placeholder="de, cs"
          hint="Comma-separated ISO codes. Empty = offered for every language."
        />

        <details class="rounded-md border border-gray-200 p-3">
          <summary class="cursor-pointer text-sm font-medium text-gray-700">
            Title translations ({{ translatedFormCodes.length }}/{{ INTERFACE_LANGS.length }})
          </summary>
          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              v-for="code in INTERFACE_LANGS"
              :id="`wp-title-${code}`"
              :key="code"
              v-model="titleI18n[code]"
              :label="code"
              :name="`title-${code}`"
            />
          </div>
        </details>

        <CheckboxField v-model="form.isActive" label="Active" />
        <AlertMessage v-if="formError">{{ formError }}</AlertMessage>
        <div class="flex justify-end gap-3 pt-2">
          <AppButton variant="secondary" @click="closeForm">Cancel</AppButton>
          <AppButton type="submit">Save</AppButton>
        </div>
      </form>
    </AppModal>

    <AppModal v-if="deletingId !== null" @close="deletingId = null">
      <h3 class="text-lg font-semibold text-gray-900">Delete Angle</h3>
      <p class="mt-2 text-sm text-gray-600">
        Word sets already generated from this angle stay in users' chats and dictionaries. This only removes the angle
        from the menu.
      </p>
      <div class="mt-6 flex justify-end gap-3">
        <AppButton variant="secondary" @click="deletingId = null">Cancel</AppButton>
        <AppButton variant="danger" @click="deletePreset">Delete</AppButton>
      </div>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { wordPickerPresetCreateSchema, wordPickerPresetUpdateSchema, zodErrorMessage } from "@polyglot/admin-contracts";
import { computed, onMounted, reactive, ref } from "vue";
import { type WordPickerPreset, wordPickerPresets } from "../lib/api";
import AlertMessage from "./ui/AlertMessage.vue";
import AppButton from "./ui/AppButton.vue";
import AppModal from "./ui/AppModal.vue";
import CheckboxField from "./ui/CheckboxField.vue";
import FormField from "./ui/FormField.vue";

/** Interface languages the bot ships locale files for — the codes a title can be translated into. */
const INTERFACE_LANGS = ["en", "ru", "cs", "de", "fr", "es", "it", "pt", "uk", "pl", "kk"] as const;

type PresetForm = {
  slug: string;
  emoji: string;
  title: string;
  prompt: string;
  sortOrder: number;
  isActive: boolean;
};

const emptyForm = (): PresetForm => ({
  slug: "",
  emoji: "✨",
  title: "",
  prompt: "",
  sortOrder: 0,
  isActive: true,
});

const items = ref<WordPickerPreset[]>([]);
const loading = ref(false);
const error = ref("");
const showForm = ref(false);
const editingId = ref<number | null>(null);
const deletingId = ref<number | null>(null);
const formError = ref("");
const form = reactive<PresetForm>(emptyForm());
const titleI18n = reactive<Record<string, string>>({});
const learningLangsText = ref("");

const translatedFormCodes = computed(() => INTERFACE_LANGS.filter((code) => (titleI18n[code] ?? "").trim().length > 0));

function translatedCodes(preset: WordPickerPreset): string[] {
  return Object.entries(preset.titleI18n)
    .filter(([, value]) => value.trim().length > 0)
    .map(([code]) => code);
}

/** Drop empty inputs so an untouched field never persists as an empty title. */
function collectTitleI18n(): Record<string, string> {
  const collected: Record<string, string> = {};
  for (const code of INTERFACE_LANGS) {
    const value = (titleI18n[code] ?? "").trim();
    if (value.length > 0) collected[code] = value;
  }
  return collected;
}

function parseLearningLangs(): string[] {
  return learningLangsText.value
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

function resetForm(preset?: WordPickerPreset): void {
  Object.assign(form, preset ? { ...preset } : emptyForm());
  for (const code of INTERFACE_LANGS) {
    titleI18n[code] = preset?.titleI18n[code] ?? "";
  }
  learningLangsText.value = preset?.learningLangs.join(", ") ?? "";
}

async function loadPresets(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    items.value = await wordPickerPresets.list();
  } catch {
    error.value = "Failed to load angles";
  } finally {
    loading.value = false;
  }
}

function openAdd(): void {
  editingId.value = null;
  formError.value = "";
  resetForm();
  showForm.value = true;
}

function openEdit(preset: WordPickerPreset): void {
  editingId.value = preset.id;
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
  const payload = {
    ...form,
    sortOrder: Number(form.sortOrder),
    titleI18n: collectTitleI18n(),
    learningLangs: parseLearningLangs(),
  };

  try {
    if (editingId.value !== null) {
      const { slug: _slug, ...updatable } = payload;
      const parsed = wordPickerPresetUpdateSchema.safeParse(updatable);
      if (!parsed.success) {
        formError.value = zodErrorMessage(parsed.error);
        return;
      }
      await wordPickerPresets.update(editingId.value, parsed.data);
    } else {
      const parsed = wordPickerPresetCreateSchema.safeParse(payload);
      if (!parsed.success) {
        formError.value = zodErrorMessage(parsed.error);
        return;
      }
      await wordPickerPresets.create(parsed.data);
    }
    closeForm();
    await loadPresets();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "Failed to save";
  }
}

async function deletePreset(): Promise<void> {
  if (deletingId.value === null) return;
  try {
    await wordPickerPresets.delete(deletingId.value);
    deletingId.value = null;
    await loadPresets();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to delete";
  }
}

onMounted(() => {
  void loadPresets();
});
</script>

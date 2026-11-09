<template>
  <div class="mt-4 space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <label class="sr-only" for="dictionary-switch">{{ t("web.dictionaries.label") }}</label>
      <div class="min-w-0 flex-1 sm:max-w-xs">
        <AppSelect
          id="dictionary-switch"
          :model-value="current ? String(current.id) : ''"
          :options="dictionaryOptions"
          @update:model-value="(value) => emit('select', Number(value))"
        />
      </div>
      <button type="button" class="btn-secondary" :aria-label="t('web.dictionaries.create')" @click="open('create')">
        <Plus class="size-4" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.dictionaries.create") }}</span>
      </button>
      <template v-if="current && !current.isDefault">
        <button type="button" class="btn-secondary" :aria-label="t('web.dictionaries.rename')" @click="open('rename')">
          <Pencil class="size-4" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.dictionaries.rename") }}</span>
        </button>
        <button type="button" class="btn-secondary !text-danger" :aria-label="t('web.dictionaries.delete')" @click="open('delete')">
          <Trash2 class="size-4" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.dictionaries.delete") }}</span>
        </button>
      </template>
    </div>

    <form v-if="mode === 'create' || mode === 'rename'" class="flex flex-wrap gap-2" @submit.prevent="submitName">
      <label class="sr-only" for="dictionary-name">{{ t("web.dictionaries.namePlaceholder") }}</label>
      <input
        id="dictionary-name"
        ref="nameInput"
        v-model="name"
        class="field min-w-0 flex-1 sm:max-w-xs"
        :maxlength="MAX_NAME"
        :placeholder="t('web.dictionaries.namePlaceholder')"
      />
      <button type="submit" class="btn-primary" :disabled="busy">{{ t("web.dictionaries.save") }}</button>
      <button type="button" class="btn-secondary" @click="close">{{ t("web.dictionaries.cancel") }}</button>
    </form>

    <div v-if="mode === 'delete' && current" class="flex flex-wrap items-center gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm" role="alertdialog">
      <span class="min-w-0 flex-1 break-words">{{ t("web.dictionaries.deleteConfirm", { name: current.name }) }}</span>
      <button type="button" class="btn-secondary !text-danger" :disabled="busy" @click="confirmDelete">{{ t("web.dictionaries.delete") }}</button>
      <button type="button" class="btn-secondary" @click="close">{{ t("web.dictionaries.cancel") }}</button>
    </div>

    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { Pencil, Plus, Trash2 } from "lucide-vue-next";
import { computed, nextTick, ref } from "vue";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import type { Dictionary } from "../lib/types";
import AppSelect from "./AppSelect.vue";

// Mirrors MAX_DICTIONARY_NAME_LENGTH in core; the server is what enforces it.
const MAX_NAME = 32;

const props = defineProps<{ dictionaries: Dictionary[]; currentId: number | null }>();
const emit = defineEmits<{ select: [id: number]; changed: [selectId: number | null] }>();

const dictionaryOptions = computed(() => props.dictionaries.map((d) => ({ value: String(d.id), label: `${d.name} · ${d.count}` })));
const current = computed(() => props.dictionaries.find((d) => d.id === props.currentId) ?? props.dictionaries[0] ?? null);
const mode = ref<"create" | "rename" | "delete" | null>(null);
const name = ref("");
const busy = ref(false);
const error = ref("");
const nameInput = ref<HTMLInputElement | null>(null);

function open(next: "create" | "rename" | "delete"): void {
  mode.value = next;
  error.value = "";
  name.value = next === "rename" ? (current.value?.name ?? "") : "";
  if (next !== "delete") void nextTick(() => nameInput.value?.focus());
}

function close(): void {
  mode.value = null;
  error.value = "";
}

async function submitName(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const saved =
      mode.value === "rename" && current.value
        ? await api.renameDictionary(current.value.id, name.value)
        : await api.createDictionary(name.value);
    close();
    emit("changed", saved.id);
  } catch (err) {
    error.value =
      err instanceof ApiError && err.code === "invalid_name"
        ? t("web.dictionaries.nameInvalid", { max: MAX_NAME })
        : t("web.common.error");
  } finally {
    busy.value = false;
  }
}

async function confirmDelete(): Promise<void> {
  const target = current.value;
  if (!target || busy.value) return;
  busy.value = true;
  try {
    await api.deleteDictionary(target.id);
    close();
    emit("changed", null);
  } catch {
    error.value = t("web.common.error");
  } finally {
    busy.value = false;
  }
}
</script>

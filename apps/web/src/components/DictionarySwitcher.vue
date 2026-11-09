<template>
  <div class="mt-4 flex items-center gap-3">
    <label class="sr-only" for="dictionary-switch">{{ t("web.dictionaries.label") }}</label>
    <div class="min-w-0 flex-1 sm:max-w-xs">
      <AppSelect
        id="dictionary-switch"
        :model-value="current?.id"
        :options="dictionaries.map((d) => ({ value: d.id, label: `${d.name} · ${d.count}` }))"
        @update:model-value="(id) => emit('select', id)"
      />
    </div>
    <button type="button" class="btn-secondary" :aria-label="t('web.dictionaries.create')" @click="open('create')">
      <Plus class="size-4" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.dictionaries.create") }}</span>
    </button>
    <template v-if="current && !current.isDefault">
      <button type="button" class="btn-secondary !px-3" :aria-label="t('web.dictionaries.rename')" :title="t('web.dictionaries.rename')" @click="open('rename')">
        <Pencil class="size-4" aria-hidden="true" />
      </button>
      <button type="button" class="btn-secondary !px-3 !text-danger" :aria-label="t('web.dictionaries.delete')" :title="t('web.dictionaries.delete')" @click="open('delete')">
        <Trash2 class="size-4" aria-hidden="true" />
      </button>
    </template>

    <!-- Create, rename and delete each get a roomy dialog instead of a row that pushes the list down. -->
    <BottomSheet :open="mode !== null" @close="close">
      <template #title>{{ mode === "delete" ? t("web.dictionaries.delete") : mode === "rename" ? t("web.dictionaries.rename") : t("web.dictionaries.create") }}</template>
      <form v-if="mode === 'create' || mode === 'rename'" id="dictionary-name-form" class="space-y-2" @submit.prevent="submitName">
        <label class="block text-sm font-medium" for="dictionary-name">{{ t("web.dictionaries.namePlaceholder") }}</label>
        <input
          id="dictionary-name"
          ref="nameInput"
          v-model="name"
          class="field min-h-12"
          :maxlength="MAX_NAME"
          :placeholder="t('web.dictionaries.namePlaceholder')"
        />
        <p class="text-right text-sm text-ink-muted">{{ name.length }}/{{ MAX_NAME }}</p>
      </form>
      <p v-else-if="current" class="text-base">{{ t("web.dictionaries.deleteConfirm", { name: current.name }) }}</p>
      <p v-if="error" role="alert" class="mt-3 text-sm text-danger">{{ error }}</p>
      <template #footer>
        <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" class="btn-secondary" @click="close">{{ t("web.dictionaries.cancel") }}</button>
          <button v-if="mode === 'delete'" type="button" class="btn-primary !bg-danger" :disabled="busy" @click="confirmDelete">{{ t("web.dictionaries.delete") }}</button>
          <button v-else type="submit" form="dictionary-name-form" class="btn-primary" :disabled="busy || name.trim() === ''">{{ t("web.dictionaries.save") }}</button>
        </div>
      </template>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { Pencil, Plus, Trash2 } from "lucide-vue-next";
import AppSelect from "./AppSelect.vue";
import BottomSheet from "./BottomSheet.vue";
import { computed, nextTick, ref } from "vue";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import type { Dictionary } from "../lib/types";

// Mirrors MAX_DICTIONARY_NAME_LENGTH in core; the server is what enforces it.
const MAX_NAME = 32;

const props = defineProps<{ dictionaries: Dictionary[]; currentId: number | null }>();
const emit = defineEmits<{ select: [id: number]; changed: [selectId: number | null] }>();

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
  // Wait for the dialog to mount before focusing its field.
  if (next !== "delete") void nextTick(() => setTimeout(() => nameInput.value?.focus(), 50));
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

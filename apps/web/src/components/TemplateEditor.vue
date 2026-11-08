<template>
  <section class="card mt-6 space-y-6" aria-labelledby="template-title">
    <div>
      <h2 id="template-title" class="text-lg font-semibold">{{ t("web.template.title") }}</h2>
      <p class="mt-1 text-sm text-ink-muted">
        {{ t("web.template.hint") }}
        <span v-if="state">· {{ state.custom ? t("web.template.custom") : t("web.template.default") }}</span>
      </p>
    </div>

    <template v-if="fields">
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label
          v-for="key in FIELD_KEYS"
          :key="key"
          class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
        >
          <input v-model="fields[key]" type="checkbox" class="size-4 accent-primary" @change="refreshPreview" />
          {{ t(`web.template.field.${key}`) }}
        </label>
      </div>

      <div v-if="preview" class="rounded-xl border border-dashed border-line p-4">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.template.preview") }}</h3>
        <p class="mt-2 text-lg font-bold"><span v-if="preview.emoji" class="mr-2" aria-hidden="true">{{ preview.emoji }}</span>{{ preview.original }}</p>
        <TranslationBlock v-for="translation in preview.translations" :key="translation.lang" class="mt-3" :translation="translation" id-prefix="template-preview" />
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class="btn-primary" :disabled="busy" @click="saveFields">{{ t("web.common.save") }}</button>
        <button v-if="state?.custom" type="button" class="btn-secondary" :disabled="busy" @click="run(() => api.resetTemplate())">{{ t("web.template.reset") }}</button>
        <span v-if="saved" role="status" class="text-sm text-primary-soft-fg">{{ t("web.common.saved") }}</span>
      </div>
    </template>
    <p v-if="failed" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import type { TemplateFields, TemplateState, TranslateResult } from "../lib/types";
import TranslationBlock from "./TranslationBlock.vue";

const FIELD_KEYS: (keyof TemplateFields)[] = ["synonyms", "examples", "alternatives", "equivalentNote", "connotationWarning"];

const state = ref<TemplateState | null>(null);
const fields = ref<TemplateFields | null>(null);
const preview = ref<TranslateResult | null>(null);
const busy = ref(false);
const saved = ref(false);
const failed = ref(false);

function adopt(next: TemplateState): void {
  state.value = next;
  fields.value = { ...next.fields };
}

async function refreshPreview(): Promise<void> {
  saved.value = false;
  if (!fields.value) return;
  try {
    preview.value = await api.previewTemplate({ ...fields.value });
  } catch {
    failed.value = true;
  }
}

async function run(action: () => Promise<TemplateState>): Promise<void> {
  busy.value = true;
  saved.value = false;
  failed.value = false;
  try {
    adopt(await action());
    await refreshPreview();
    saved.value = true;
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}

function saveFields(): void {
  const current = fields.value;
  if (current) void run(() => api.saveTemplate({ ...current }));
}

onMounted(async () => {
  try {
    adopt(await api.template());
    await refreshPreview();
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <div class="space-y-5">
    <p class="text-sm text-gray-500">
      AI model for the mentor chat mode. Mentor answers free-form grammar questions, so it usually runs a smarter
      model than the translate pipeline. "Use default model chain" answers with the plan-routed / globally default
      model instead.
    </p>

    <p v-if="loading" class="text-sm text-gray-400">Loading...</p>
    <AlertMessage v-else-if="loadError" tone="error" :message="loadError" />

    <form v-else class="space-y-5" @submit.prevent="save">
      <SelectField
        id="mentor-model"
        v-model="form.modelId"
        label="Model"
        name="modelId"
        :options="modelOptions"
      />
      <p v-if="modelsError" class="text-sm text-amber-700">
        {{ modelsError }} — the current model is kept; saving still works.
      </p>
      <p v-else-if="selectedModel" class="text-sm text-gray-500">
        {{ formatPrice(selectedModel.pricing) }}
      </p>

      <FormField
        id="mentor-max-tokens"
        v-model="form.maxTokens"
        label="Max answer tokens"
        name="maxTokens"
        type="number"
        hint="Output cap per mentor answer. 700 fits a grammar explanation with a few examples in one Telegram message."
      />

      <AlertMessage v-if="saveError" tone="error" :message="saveError" />
      <AlertMessage v-if="success" tone="success" message="Settings saved successfully" />

      <div class="flex justify-end">
        <AppButton type="submit">Save Changes</AppButton>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { type MentorModelOption, settings } from "../lib/api";
import AlertMessage from "./ui/AlertMessage.vue";
import AppButton from "./ui/AppButton.vue";
import FormField from "./ui/FormField.vue";
import SelectField from "./ui/SelectField.vue";

const DEFAULT_CHAIN_OPTION = { value: "", label: "Use default model chain (plan-routed → global default)" };

const form = reactive({ modelId: "", maxTokens: 700 });
const models = ref<MentorModelOption[]>([]);
const loading = ref(true);
const loadError = ref("");
const modelsError = ref("");
const saveError = ref("");
const success = ref(false);

const selectedModel = computed(() => models.value.find((m) => m.id === form.modelId) ?? null);

/**
 * The saved model is always offered, even when the catalogue fetch failed or the
 * model has since been withdrawn — otherwise opening this tab would silently
 * reset a working configuration to whatever sorts first.
 */
const modelOptions = computed(() => {
  const options = models.value.map((m) => ({ value: m.id, label: `${m.name} (${m.id})` }));
  if (form.modelId && !options.some((o) => o.value === form.modelId)) {
    options.unshift({ value: form.modelId, label: `${form.modelId} (not in catalogue)` });
  }
  return [DEFAULT_CHAIN_OPTION, ...options];
});

function formatPrice(pricing: { prompt: string; completion: string }): string {
  const promptPerM = Number(pricing.prompt) * 1_000_000;
  const completionPerM = Number(pricing.completion) * 1_000_000;
  if (!(promptPerM > 0) && !(completionPerM > 0)) return "no per-token price";
  return `$${promptPerM.toFixed(2)} in / $${completionPerM.toFixed(2)} out per 1M tokens`;
}

async function save(): Promise<void> {
  saveError.value = "";
  success.value = false;
  try {
    await settings.mentor.update({
      modelId: String(form.modelId),
      maxTokens: Number(form.maxTokens),
    });
    success.value = true;
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : "Failed to save";
  }
}

onMounted(async () => {
  try {
    const current = await settings.mentor.get();
    Object.assign(form, current);
  } catch {
    loadError.value = "Failed to load mentor settings";
    loading.value = false;
    return;
  }

  // A catalogue failure must not block editing — it only costs the picker.
  try {
    models.value = await settings.mentor.models();
  } catch {
    modelsError.value = "Could not load the OpenRouter model catalogue";
  }
  loading.value = false;
});
</script>

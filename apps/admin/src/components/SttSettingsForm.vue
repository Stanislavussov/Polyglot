<template>
  <div class="space-y-5">
    <p class="text-sm text-gray-500">
      Speech-to-text for voice messages sent to the bot. The model is picked from OpenRouter's live transcription
      catalogue.
    </p>

    <p v-if="loading" class="text-sm text-gray-400">Loading...</p>
    <AlertMessage v-else-if="loadError" tone="error" :message="loadError" />

    <form v-else class="space-y-5" @submit.prevent="save">
      <CheckboxField v-model="form.enabled" label="Enabled — transcribe voice messages sent to the bot" />

      <SelectField
        id="stt-model"
        v-model="form.modelId"
        label="Model"
        name="modelId"
        :options="modelOptions"
      />
      <p v-if="modelsError" class="text-sm text-amber-700">
        {{ modelsError }} — the current model is kept; saving still works.
      </p>
      <p v-else-if="selectedModel" class="text-sm text-gray-500">
        {{ formatPrice(selectedModel.pricing.prompt) }}
      </p>

      <FormField
        id="stt-max-duration"
        v-model="form.maxDurationSec"
        label="Max duration (seconds)"
        name="maxDurationSec"
        type="number"
        hint="Hard cap on voice message length accepted for transcription. Longer messages are refused."
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
import { settings, type SttModelOption } from "../lib/api";
import AlertMessage from "./ui/AlertMessage.vue";
import AppButton from "./ui/AppButton.vue";
import CheckboxField from "./ui/CheckboxField.vue";
import FormField from "./ui/FormField.vue";
import SelectField from "./ui/SelectField.vue";

const form = reactive({ enabled: false, modelId: "", maxDurationSec: 60 });
const models = ref<SttModelOption[]>([]);
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
  return options;
});

function formatPrice(pricePerSecond: string): string {
  const perMinute = Number(pricePerSecond) * 60;
  return perMinute > 0 ? `$${perMinute.toFixed(4)} / minute of audio` : "no per-second price";
}

async function save(): Promise<void> {
  saveError.value = "";
  success.value = false;
  try {
    await settings.stt.update({
      enabled: Boolean(form.enabled),
      modelId: String(form.modelId),
      maxDurationSec: Number(form.maxDurationSec),
    });
    success.value = true;
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : "Failed to save";
  }
}

onMounted(async () => {
  try {
    const current = await settings.stt.get();
    Object.assign(form, current);
  } catch {
    loadError.value = "Failed to load STT settings";
    loading.value = false;
    return;
  }

  // A catalogue failure must not block editing — it only costs the picker.
  try {
    models.value = await settings.stt.models();
  } catch {
    modelsError.value = "Could not load the OpenRouter transcription catalogue";
  }
  loading.value = false;
});
</script>

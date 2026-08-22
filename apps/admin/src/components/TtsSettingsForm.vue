<template>
  <div class="space-y-5">
    <p class="text-sm text-gray-500">
      Text-to-speech for the pronunciation button on translation cards. The model and voice are picked from
      OpenRouter's live speech catalogue; use Test voice before saving — a model can accept the request and still
      return a format Telegram cannot play.
    </p>

    <p v-if="loading" class="text-sm text-gray-400">Loading...</p>
    <AlertMessage v-else-if="loadError" tone="error" :message="loadError" />

    <form v-else class="space-y-5" @submit.prevent="save">
      <CheckboxField v-model="form.enabled" label="Enabled — show the pronunciation button on translation cards" />

      <SelectField
        id="tts-model"
        v-model="form.modelId"
        label="Model"
        name="modelId"
        :options="modelOptions"
      />
      <p v-if="modelsError" class="text-sm text-amber-700">
        {{ modelsError }} — the current model is kept; saving still works.
      </p>
      <p v-else-if="selectedModel" class="text-sm text-gray-500">
        {{ formatPrice(selectedModel.pricePerMillionChars) }}
        · {{ selectedModel.voices.length || "no named" }} voices
      </p>

      <SelectField
        v-if="voiceOptions.length > 0"
        id="tts-voice"
        v-model="form.voice"
        label="Voice"
        name="voice"
        :options="voiceOptions"
      />
      <FormField
        v-else
        id="tts-voice-free"
        v-model="form.voice"
        label="Voice"
        name="voice"
        hint="This model publishes no voice list. Leave empty unless its documentation names one."
      />

      <FormField
        id="tts-max-chars"
        v-model="form.maxChars"
        label="Max characters"
        name="maxChars"
        type="number"
        hint="Hard cap on the text sent for synthesis. Longer text is refused rather than truncated."
      />

      <div class="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4">
        <AppButton type="button" variant="secondary" :disabled="probing || !form.modelId" @click="probe">
          {{ probing ? "Testing…" : "Test voice" }}
        </AppButton>
        <p v-if="probeResult" :class="probeResult.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'">
          {{ probeSummary }}
        </p>
      </div>

      <AlertMessage v-if="saveError" tone="error" :message="saveError" />
      <AlertMessage v-if="success" tone="success" message="Settings saved successfully" />

      <div class="flex justify-end">
        <AppButton type="submit">Save Changes</AppButton>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { settings, type TtsModelOption, type TtsProbeResult } from "../lib/api";
import AlertMessage from "./ui/AlertMessage.vue";
import AppButton from "./ui/AppButton.vue";
import CheckboxField from "./ui/CheckboxField.vue";
import FormField from "./ui/FormField.vue";
import SelectField from "./ui/SelectField.vue";

const form = reactive({ enabled: false, modelId: "", voice: "", maxChars: 200 });
const models = ref<TtsModelOption[]>([]);
const loading = ref(true);
const loadError = ref("");
const modelsError = ref("");
const saveError = ref("");
const success = ref(false);
const probing = ref(false);
const probeResult = ref<TtsProbeResult | null>(null);

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

const voiceOptions = computed(() =>
  (selectedModel.value?.voices ?? []).map((voice) => ({ value: voice, label: voice })),
);

const probeSummary = computed(() => {
  const result = probeResult.value;
  if (!result) return "";
  if (result.ok) return `OK — ${result.bytes} bytes of ${result.contentType} in ${result.durationMs} ms`;
  return `Failed${result.status ? ` (${result.status})` : ""}: ${result.error ?? "unknown error"}`;
});

function formatPrice(pricePerMillionChars: number): string {
  return pricePerMillionChars > 0 ? `$${pricePerMillionChars.toFixed(2)} / 1M characters` : "no per-character price";
}

// Switching models invalidates both the chosen voice and the previous verdict.
watch(
  () => form.modelId,
  () => {
    probeResult.value = null;
    const voices = selectedModel.value?.voices ?? [];
    if (voices.length > 0 && !voices.includes(form.voice)) {
      form.voice = voices[0]!;
    }
  },
);

async function probe(): Promise<void> {
  probing.value = true;
  probeResult.value = null;
  try {
    probeResult.value = await settings.tts.probe(form.modelId, form.voice);
  } catch (err) {
    probeResult.value = {
      ok: false,
      durationMs: 0,
      status: 0,
      error: err instanceof Error ? err.message : "Probe request failed",
    };
  } finally {
    probing.value = false;
  }
}

async function save(): Promise<void> {
  saveError.value = "";
  success.value = false;
  try {
    await settings.tts.update({
      enabled: Boolean(form.enabled),
      modelId: String(form.modelId),
      voice: String(form.voice),
      maxChars: Number(form.maxChars),
    });
    success.value = true;
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : "Failed to save";
  }
}

onMounted(async () => {
  try {
    const current = await settings.tts.get();
    Object.assign(form, current);
  } catch {
    loadError.value = "Failed to load TTS settings";
    loading.value = false;
    return;
  }

  // A catalogue failure must not block editing — it only costs the picker.
  try {
    models.value = await settings.tts.models();
  } catch {
    modelsError.value = "Could not load the OpenRouter speech catalogue";
  }
  loading.value = false;
});
</script>

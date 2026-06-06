<template>
  <div class="mt-6">
    <div class="border-b border-gray-200">
      <nav class="-mb-px flex space-x-6 overflow-x-auto" aria-label="Settings categories">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="border-b-2 px-1 py-3 text-sm font-medium whitespace-nowrap"
          :class="
            activeTab === tab.key
              ? 'border-indigo-500 text-indigo-600'
              : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
          "
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>
    </div>

    <div class="mt-6">
      <p v-if="loading" class="text-sm text-gray-400">Loading...</p>
      <p v-else-if="loadError" class="text-sm text-red-600">{{ loadError }}</p>
      <form v-else class="space-y-4" @submit.prevent="save">
        <div v-for="field in fields" :key="field.key" class="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-start sm:gap-4">
          <label :for="`s-${field.key}`" class="pt-2 text-sm font-medium text-gray-700 capitalize">
            {{ formatLabel(field.key) }}
          </label>
          <div v-if="typeof field.value === 'boolean'" class="flex items-center gap-2">
            <input
              :id="`s-${field.key}`"
              v-model="form[field.key]"
              :name="field.key"
              type="checkbox"
              class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
          </div>
          <input
            v-else
            :id="`s-${field.key}`"
            v-model="form[field.key]"
            :name="field.key"
            :type="typeof field.value === 'number' ? 'number' : 'text'"
            class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div v-if="saveError" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{{ saveError }}</div>
        <div v-if="success" class="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Settings saved successfully
        </div>
        <div class="flex justify-end pt-2">
          <button
            type="submit"
            class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Save Changes
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { settings } from "../lib/api";

type SettingsValue = string | number | boolean;
type SettingsRecord = Record<string, SettingsValue>;
type SettingsGroup = "ai-defaults" | "notifications" | "srs" | "translation" | "dictionary";

const tabs: Array<{ key: SettingsGroup; label: string }> = [
  { key: "ai-defaults", label: "AI Defaults" },
  { key: "notifications", label: "Notifications" },
  { key: "srs", label: "SRS" },
  { key: "translation", label: "Translation" },
  { key: "dictionary", label: "Dictionary" },
];

const activeTab = ref<SettingsGroup>("ai-defaults");
const form = reactive<SettingsRecord>({});
const original = ref<SettingsRecord>({});
const loading = ref(false);
const loadError = ref("");
const saveError = ref("");
const success = ref(false);

const fields = computed(() => Object.entries(original.value).map(([key, value]) => ({ key, value })));

function toRecord(value: object): SettingsRecord {
  const record: SettingsRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      record[key] = item;
    }
  }
  return record;
}

function syncForm(data: SettingsRecord): void {
  for (const key of Object.keys(form)) {
    delete form[key];
  }
  for (const [key, value] of Object.entries(data)) {
    form[key] = value;
  }
}

function formatLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim();
}

async function loadTab(group: SettingsGroup): Promise<void> {
  loading.value = true;
  loadError.value = "";
  saveError.value = "";
  success.value = false;
  try {
    let data: SettingsRecord;
    if (group === "ai-defaults") data = toRecord(await settings.aiDefaults.get());
    else if (group === "notifications") data = toRecord(await settings.notifications.get());
    else if (group === "srs") data = toRecord(await settings.srs.get());
    else if (group === "translation") data = toRecord(await settings.translation.get());
    else data = toRecord(await settings.dictionary.get());

    original.value = data;
    syncForm(data);
  } catch {
    loadError.value = "Failed to load settings";
  } finally {
    loading.value = false;
  }
}

function valueFor(key: string): SettingsValue {
  const value = form[key];
  const originalValue = original.value[key];
  if (typeof originalValue === "number") {
    return Number(value);
  }
  if (typeof originalValue === "boolean") {
    return Boolean(value);
  }
  return String(value ?? "");
}

function currentPayload(): SettingsRecord {
  const payload: SettingsRecord = {};
  for (const key of Object.keys(original.value)) {
    payload[key] = valueFor(key);
  }
  return payload;
}

async function save(): Promise<void> {
  saveError.value = "";
  success.value = false;
  const payload = currentPayload();

  try {
    if (activeTab.value === "ai-defaults") {
      await settings.aiDefaults.update({
        maxTokens: Number(payload.maxTokens),
        temperature: Number(payload.temperature),
        frequencyPenalty: Number(payload.frequencyPenalty),
        maxRetries: Number(payload.maxRetries),
      });
    } else if (activeTab.value === "notifications") {
      await settings.notifications.update({
        defaultTime: String(payload.defaultTime),
        defaultType: String(payload.defaultType),
        inactivityDays: Number(payload.inactivityDays),
      });
    } else if (activeTab.value === "srs") {
      await settings.srs.update({
        minEaseFactor: Number(payload.minEaseFactor),
        defaultEaseFactor: Number(payload.defaultEaseFactor),
      });
    } else if (activeTab.value === "translation") {
      await settings.translation.update(payload);
    } else {
      await settings.dictionary.update(payload);
    }
    original.value = payload;
    success.value = true;
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : "Failed to save";
  }
}

watch(activeTab, (tab) => {
  void loadTab(tab);
});

onMounted(() => {
  void loadTab(activeTab.value);
});
</script>

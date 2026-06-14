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
        <p class="text-sm text-gray-500">{{ activeTabDescription }}</p>
        <div v-for="field in fields" :key="field.key" class="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-start sm:gap-4">
          <div class="flex items-start gap-1.5 pt-2">
            <label :for="`s-${field.key}`" class="text-sm font-medium text-gray-700 capitalize">
              {{ formatLabel(field.key) }}
            </label>
            <button
              type="button"
              class="group relative inline-flex rounded-full text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              :aria-label="`${formatLabel(field.key)} description`"
              :title="field.description"
            >
              <Info
                class="mt-0.5 h-4 w-4 text-gray-400"
                aria-hidden="true"
              />
              <span
                role="tooltip"
                class="pointer-events-none absolute left-1/2 top-6 z-10 hidden w-72 -translate-x-1/2 rounded-md bg-gray-900 px-3 py-2 text-xs font-normal leading-5 text-white shadow-lg group-hover:block group-focus-within:block"
              >
                {{ field.description }}
              </span>
            </button>
          </div>
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
import { Info } from "lucide-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { settings } from "../lib/api";

type SettingsValue = string | number | boolean;
type SettingsRecord = Record<string, SettingsValue>;
type SettingsGroup = "ai-defaults" | "notifications" | "srs" | "dictionary";
type FieldDescriptionMap = Record<SettingsGroup, Record<string, string>>;

const tabs: Array<{ key: SettingsGroup; label: string }> = [
  { key: "ai-defaults", label: "AI Defaults" },
  { key: "notifications", label: "Notifications" },
  { key: "srs", label: "SRS" },
  { key: "dictionary", label: "Dictionary" },
];

const activeTab = ref<SettingsGroup>("ai-defaults");
const form = reactive<SettingsRecord>({});
const original = ref<SettingsRecord>({});
const loading = ref(false);
const loadError = ref("");
const saveError = ref("");
const success = ref(false);

const fieldDescriptions: FieldDescriptionMap = {
  "ai-defaults": {
    maxTokens: "Maximum number of tokens the AI may generate in one response. Higher values allow longer answers but cost more and take longer.",
    temperature: "Controls randomness in AI output from 0 to 2. Lower values are more consistent; higher values are more creative.",
    frequencyPenalty: "Reduces repeated words and phrases in AI output. Use higher values when responses become repetitive.",
    maxRetries: "How many times Polyglot retries an AI request after validation or provider failures before returning an error.",
  },
  notifications: {
    defaultTime: "Default local time for scheduled user notifications. Use 24-hour HH:MM format.",
    defaultType: "Default notification source for users who have not chosen one: suggested words, SRS reviews, or contextual prompts.",
    inactivityDays: "Number of inactive days after which notification handling treats a user as inactive.",
  },
  srs: {
    minEaseFactor: "Lowest allowed SRS ease factor. This prevents difficult cards from becoming too aggressively scheduled.",
    defaultEaseFactor: "Starting SRS ease factor for new cards before the user has review history.",
  },
  dictionary: {
    flashcardLimit: "Maximum number of dictionary entries shown when building flashcards.",
    notificationDictLimit: "Maximum number of dictionary entries considered when selecting notification content.",
    wordOfDayLimit: "Maximum number of dictionary entries considered for word-of-day style suggestions.",
  },
};

const tabDescriptions: Record<SettingsGroup, string> = {
  "ai-defaults": "Defaults applied to AI generation when a more specific model or workflow setting does not override them.",
  notifications: "Defaults for scheduled notification timing, source selection, and inactivity handling.",
  srs: "Scheduling parameters for spaced repetition cards and review intervals.",
  dictionary: "Caps used when dictionary entries are selected for flashcards, notifications, and daily suggestions.",
};

const fields = computed(() =>
  Object.entries(original.value).map(([key, value]) => ({
    key,
    value,
    description: descriptionFor(activeTab.value, key),
  })),
);

const activeTabDescription = computed(() => tabDescriptions[activeTab.value]);

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

function descriptionFor(group: SettingsGroup, key: string): string {
  return fieldDescriptions[group][key] ?? `${formatLabel(key)} setting for the ${tabLabel(group)} configuration group.`;
}

function tabLabel(group: SettingsGroup): string {
  return tabs.find((tab) => tab.key === group)?.label ?? group;
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

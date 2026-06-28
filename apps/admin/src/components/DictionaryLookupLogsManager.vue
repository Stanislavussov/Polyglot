<template>
  <div class="mt-6 space-y-5">
    <div class="flex flex-wrap items-center gap-3">
      <label for="lookup-days-window" class="text-sm font-medium text-gray-700">Window</label>
      <select
        id="lookup-days-window"
        v-model.number="days"
        class="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option v-for="option in dayOptions" :key="option" :value="option">{{ option }} days</option>
      </select>
    </div>

    <AlertMessage v-if="error">{{ error }}</AlertMessage>
    <p v-else-if="loading" class="text-sm text-gray-400">Loading...</p>

    <template v-else-if="data">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Lookups</p>
          <p class="mt-2 text-2xl font-bold text-gray-900 tabular-nums">{{ data.summary.totalLookups }}</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Matched</p>
          <p class="mt-2 text-2xl font-bold text-emerald-700 tabular-nums">{{ data.summary.matchedLookups }}</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Match rate</p>
          <p class="mt-2 text-2xl font-bold text-indigo-700 tabular-nums">{{ formatPercent(data.summary.matchRate) }}</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Failed</p>
          <p class="mt-2 text-2xl font-bold text-rose-700 tabular-nums">{{ data.summary.failedLookups }}</p>
        </div>
      </div>

      <p v-if="data.logs.length === 0" class="text-sm text-gray-400">No dictionary lookups recorded yet</p>
      <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Time</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Lookup</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Lang</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Status</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Matched value</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Glosses</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="log in data.logs" :key="log.id" class="transition-colors hover:bg-gray-50">
              <td class="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{{ formatDate(log.createdAt) }}</td>
              <td class="px-4 py-3 text-sm">
                <div class="font-medium text-gray-900">{{ log.lookupInput }}</div>
                <div class="text-xs text-gray-500">{{ log.normalizedInput }}</div>
              </td>
              <td class="px-4 py-3 text-sm font-medium text-gray-700 whitespace-nowrap">{{ log.langCode }}</td>
              <td class="px-4 py-3 text-sm whitespace-nowrap">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="statusClass(log)"
                >
                  {{ statusLabel(log) }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-gray-900">
                <div v-if="log.matchedWord" class="font-medium">{{ log.matchedWord }}</div>
                <div v-if="log.matchType || log.matchedPos" class="text-xs text-gray-500">
                  {{ [log.matchType, log.matchedPos].filter(Boolean).join(" / ") }}
                </div>
                <div v-if="log.error" class="max-w-xs text-xs text-rose-700">{{ log.error }}</div>
              </td>
              <td class="max-w-md px-4 py-3 text-sm text-gray-600">
                {{ formatGlosses(log.matchedGlosses) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">Showing {{ data.logs.length }} of {{ data.total }}</p>
        <div class="flex gap-2">
          <button
            class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="page <= 1"
            @click="page -= 1"
          >
            Previous
          </button>
          <button
            class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="page * limit >= data.total"
            @click="page += 1"
          >
            Next
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import {
  dictionaryLookupLogs,
  type DictionaryLookupLog,
  type DictionaryLookupLogResponse,
} from "../lib/api";
import AlertMessage from "./ui/AlertMessage.vue";

const dayOptions = [1, 7, 14, 30, 90] as const;
const days = ref<number>(7);
const page = ref<number>(1);
const limit = 50;
const data = ref<DictionaryLookupLogResponse | null>(null);
const loading = ref(false);
const error = ref("");

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    data.value = await dictionaryLookupLogs.list(page.value, limit, days.value);
  } catch {
    error.value = "Failed to load dictionary lookup logs";
  } finally {
    loading.value = false;
  }
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(log: DictionaryLookupLog): string {
  if (log.error) return "Failed";
  if (log.matched) return `Matched ${log.matchCount}`;
  return "No match";
}

function statusClass(log: DictionaryLookupLog): string {
  if (log.error) return "bg-rose-100 text-rose-800";
  if (log.matched) return "bg-emerald-100 text-emerald-800";
  return "bg-gray-100 text-gray-700";
}

function formatGlosses(glosses: string[] | null): string {
  if (!glosses || glosses.length === 0) return "—";
  return glosses.slice(0, 3).join("; ");
}

watch(days, () => {
  page.value = 1;
  void load();
});

watch(page, () => {
  void load();
});

onMounted(() => {
  void load();
});
</script>

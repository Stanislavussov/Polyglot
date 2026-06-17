<template>
  <section class="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
    <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">Language Detection</h2>
        <p class="text-sm text-gray-500">Mistype warnings and user outcomes over the last {{ days }} days</p>
      </div>
      <div class="flex gap-2">
        <button
          v-for="option in dayOptions"
          :key="option"
          :class="[
            'rounded-md px-3 py-1 text-sm font-medium transition-colors',
            days === option
              ? 'bg-blue-100 text-blue-700'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
          ]"
          @click="loadData(option)"
        >
          {{ option }}d
        </button>
      </div>
    </div>

    <div v-if="loading" class="mt-6 flex h-72 items-center justify-center text-sm text-gray-500">
      Loading detection data...
    </div>
    <div v-else-if="error" class="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{{ error }}</div>
    <div v-else-if="byDay.length === 0" class="mt-6 flex h-72 items-center justify-center text-sm text-gray-500">
      No detection data yet
    </div>
    <div v-else class="mt-6 h-80">
      <Bar :data="chartData" :options="chartOptions" />
    </div>

    <div v-if="outcome" class="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div class="rounded-lg border border-gray-200 px-4 py-3">
        <p class="text-xs font-medium text-gray-500">Total Warnings</p>
        <p class="mt-1 text-2xl font-semibold text-gray-900">{{ outcome.totalWarnings.toLocaleString() }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 px-4 py-3">
        <p class="text-xs font-medium text-gray-500">Confirmed</p>
        <p class="mt-1 text-2xl font-semibold text-emerald-600">{{ outcome.totalConfirmed.toLocaleString() }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 px-4 py-3">
        <p class="text-xs font-medium text-gray-500">Cancelled</p>
        <p class="mt-1 text-2xl font-semibold text-amber-600">{{ outcome.totalCancelled.toLocaleString() }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 px-4 py-3">
        <p class="text-xs font-medium text-gray-500">Confirm Rate</p>
        <p class="mt-1 text-2xl font-semibold text-gray-900">{{ (outcome.confirmRate * 100).toFixed(1) }}%</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { computed, onMounted, ref } from "vue";
import { Bar } from "vue-chartjs";
import {
  languageDetection,
  type LanguageDetectionDaySummary,
  type LanguageDetectionOutcomeSummary,
} from "../lib/api";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const dayOptions = [3, 7, 14, 30];
const days = ref(7);
const byDay = ref<LanguageDetectionDaySummary[]>([]);
const outcome = ref<LanguageDetectionOutcomeSummary | null>(null);
const loading = ref(true);
const error = ref("");

const chartData = computed<ChartData<"bar">>(() => ({
  labels: byDay.value.map((row) => row.date),
  datasets: [
    {
      label: "Warnings Shown",
      data: byDay.value.map((row) => row.warningShown),
      backgroundColor: "#f87171",
      borderColor: "#ef4444",
      borderWidth: 1,
      borderRadius: 2,
    },
    {
      label: "Confirmed",
      data: byDay.value.map((row) => row.confirmed),
      backgroundColor: "#34d399",
      borderColor: "#10b981",
      borderWidth: 1,
      borderRadius: 2,
    },
    {
      label: "Cancelled",
      data: byDay.value.map((row) => row.cancelled),
      backgroundColor: "#fbbf24",
      borderColor: "#f59e0b",
      borderWidth: 1,
      borderRadius: 2,
    },
  ],
}));

const chartOptions: ChartOptions<"bar"> = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      stacked: true,
      ticks: {
        maxRotation: 35,
        minRotation: 0,
      },
    },
    y: {
      stacked: true,
      beginAtZero: true,
      title: {
        display: true,
        text: "Events",
      },
    },
  },
  plugins: {
    legend: {
      position: "bottom",
    },
    tooltip: {
      callbacks: {
        afterBody: (items) => {
          const item = items[0];
          if (!item) {
            return [];
          }
          const row = byDay.value[item.dataIndex];
          if (!row) {
            return [];
          }
          return [
            `Total: ${row.warningShown}`,
            `Confirm rate: ${row.warningShown > 0 ? ((row.confirmed / row.warningShown) * 100).toFixed(1) : "0.0"}%`,
          ];
        },
      },
    },
  },
};

async function loadData(newDays: number) {
  days.value = newDays;
  loading.value = true;
  error.value = "";
  try {
    const response = await languageDetection.list(newDays);
    byDay.value = response.byDay;
    outcome.value = response.outcome;
  } catch {
    error.value = "Failed to load language detection data";
  } finally {
    loading.value = false;
  }
}

onMounted(() => loadData(days.value));
</script>
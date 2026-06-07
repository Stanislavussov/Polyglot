<template>
  <section class="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
    <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">AI Model Latency</h2>
        <p class="text-sm text-gray-500">Average response time by model over the last 7 days</p>
      </div>
      <p v-if="rows.length > 0" class="text-sm text-gray-500">{{ totalRequests }} requests measured</p>
    </div>

    <div v-if="loading" class="mt-6 flex h-72 items-center justify-center text-sm text-gray-500">Loading latency data...</div>
    <div v-else-if="error" class="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{{ error }}</div>
    <div v-else-if="rows.length === 0" class="mt-6 flex h-72 items-center justify-center text-sm text-gray-500">
      No AI latency data yet
    </div>
    <div v-else class="mt-6 h-80">
      <Bar :data="chartData" :options="chartOptions" />
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
import { aiLatencyStats, type AIRequestLatencySummary } from "../lib/api";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const rows = ref<AIRequestLatencySummary[]>([]);
const loading = ref(true);
const error = ref("");

const totalRequests = computed(() => rows.value.reduce((sum, row) => sum + row.requestCount, 0));

const chartData = computed<ChartData<"bar">>(() => ({
  labels: rows.value.map((row) => row.modelId),
  datasets: [
    {
      label: "Avg latency, ms",
      data: rows.value.map((row) => row.averageDurationMs),
      backgroundColor: "#2563eb",
      borderColor: "#1d4ed8",
      borderWidth: 1,
      borderRadius: 4,
    },
    {
      label: "Max latency, ms",
      data: rows.value.map((row) => row.maxDurationMs),
      backgroundColor: "#f59e0b",
      borderColor: "#d97706",
      borderWidth: 1,
      borderRadius: 4,
    },
  ],
}));

const chartOptions: ChartOptions<"bar"> = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      ticks: {
        maxRotation: 35,
        minRotation: 0,
      },
    },
    y: {
      beginAtZero: true,
      title: {
        display: true,
        text: "Milliseconds",
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
          const row = rows.value[item.dataIndex];
          if (!row) {
            return [];
          }
          return [
            `Requests: ${row.requestCount}`,
            `Success rate: ${(row.successRate * 100).toFixed(1)}%`,
            `Avg tokens: ${row.averageInputTokens} in / ${row.averageOutputTokens} out`,
          ];
        },
      },
    },
  },
};

onMounted(async () => {
  try {
    rows.value = await aiLatencyStats.list();
  } catch {
    error.value = "Failed to load AI latency stats";
  } finally {
    loading.value = false;
  }
});
</script>

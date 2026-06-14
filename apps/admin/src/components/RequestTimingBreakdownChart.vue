<template>
  <section class="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
    <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">Request Timing Breakdown</h2>
        <p class="text-sm text-gray-500">Average duration by segment over the last {{ days }} days</p>
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
      Loading timing data...
    </div>
    <div v-else-if="error" class="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{{ error }}</div>
    <div v-else-if="byDay.length === 0" class="mt-6 flex h-72 items-center justify-center text-sm text-gray-500">
      No timing data yet
    </div>
    <div v-else class="mt-6 h-80">
      <Bar :data="chartData" :options="chartOptions" />
    </div>

    <div v-if="byModel.length > 0" class="mt-6">
      <h3 class="text-sm font-medium text-gray-700">By Model</h3>
      <div class="mt-2 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200">
              <th class="pb-2 text-left font-medium text-gray-500">Model</th>
              <th class="pb-2 text-right font-medium text-gray-500">Requests</th>
              <th class="pb-2 text-right font-medium text-gray-500">Preflight</th>
              <th class="pb-2 text-right font-medium text-gray-500">DB Lookup</th>
              <th class="pb-2 text-right font-medium text-gray-500">AI Request</th>
              <th class="pb-2 text-right font-medium text-gray-500">Total</th>
              <th class="pb-2 text-right font-medium text-gray-500">Success</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in byModel" :key="row.modelId" class="border-b border-gray-100">
              <td class="py-2 font-mono text-xs">{{ row.modelId }}</td>
              <td class="py-2 text-right tabular-nums">{{ row.requestCount }}</td>
              <td class="py-2 text-right tabular-nums">{{ row.avgPreflightMs }}ms</td>
              <td class="py-2 text-right tabular-nums">{{ row.avgDbLookupMs }}ms</td>
              <td class="py-2 text-right tabular-nums">{{ row.avgAiRequestMs }}ms</td>
              <td class="py-2 text-right tabular-nums font-medium">{{ row.avgTotalMs }}ms</td>
              <td class="py-2 text-right tabular-nums">{{ (row.successRate * 100).toFixed(1) }}%</td>
            </tr>
          </tbody>
        </table>
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
  requestTimings,
  type RequestTimingModelSummary,
  type RequestTimingSegmentSummary,
} from "../lib/api";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const dayOptions = [3, 7, 14, 30];
const days = ref(7);
const byDay = ref<RequestTimingSegmentSummary[]>([]);
const byModel = ref<RequestTimingModelSummary[]>([]);
const loading = ref(true);
const error = ref("");

const chartData = computed<ChartData<"bar">>(() => ({
  labels: byDay.value.map((row) => row.date),
  datasets: [
    {
      label: "Preflight (ms)",
      data: byDay.value.map((row) => row.avgPreflightMs),
      backgroundColor: "#60a5fa",
      borderColor: "#3b82f6",
      borderWidth: 1,
      borderRadius: 2,
    },
    {
      label: "DB Lookup (ms)",
      data: byDay.value.map((row) => row.avgDbLookupMs),
      backgroundColor: "#34d399",
      borderColor: "#10b981",
      borderWidth: 1,
      borderRadius: 2,
    },
    {
      label: "AI Request (ms)",
      data: byDay.value.map((row) => row.avgAiRequestMs),
      backgroundColor: "#f59e0b",
      borderColor: "#d97706",
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
          const row = byDay.value[item.dataIndex];
          if (!row) {
            return [];
          }
          return [
            `Total requests: ${row.requestCount}`,
            `Avg total: ${row.avgTotalMs}ms`,
            `P95 total: ${row.p95TotalMs}ms`,
            `Success rate: ${(row.successRate * 100).toFixed(1)}%`,
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
    const response = await requestTimings.list(newDays);
    byDay.value = response.byDay;
    byModel.value = response.byModel;
  } catch {
    error.value = "Failed to load request timing data";
  } finally {
    loading.value = false;
  }
}

onMounted(() => loadData(days.value));
</script>

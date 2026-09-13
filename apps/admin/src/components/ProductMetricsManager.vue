<template>
  <div class="mt-6 space-y-8">
    <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <p class="text-sm text-gray-500">
        Last {{ data?.days ?? days }} days.
        <span v-if="data">Rows are deleted after {{ data.retentionDays }} days.</span>
      </p>
      <div class="flex gap-2">
        <button
          v-for="option in dayOptions"
          :key="option"
          :class="[
            'rounded-md px-3 py-1 text-sm font-medium transition-colors',
            days === option ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
          ]"
          @click="load(option)"
        >
          {{ option }}d
        </button>
      </div>
    </div>

    <p v-if="loading" class="rounded-xl border border-gray-200 bg-white px-6 py-10 text-center text-sm text-gray-500">
      Loading product metrics...
    </p>
    <p v-else-if="error" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{{ error }}</p>
    <p
      v-else-if="isEmpty"
      class="rounded-xl border border-gray-200 bg-white px-6 py-10 text-center text-sm text-gray-500"
    >
      No product events recorded yet. They start arriving as soon as the bot with this release is deployed.
    </p>

    <template v-else>
      <section class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 class="text-lg font-semibold text-gray-900">Purchase funnel</h2>
        <p class="text-sm text-gray-500">
          Each step counts distinct people, so a user who opened the price list ten times counts once.
        </p>

        <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div v-for="step in funnel" :key="step.event" class="rounded-lg border border-gray-200 px-4 py-3">
            <p class="text-xs font-medium text-gray-500">{{ step.label }}</p>
            <p class="mt-1 text-2xl font-semibold" :class="step.tone">{{ step.users.toLocaleString() }}</p>
            <p class="mt-1 text-xs text-gray-400">
              {{ step.count.toLocaleString() }} {{ step.count === 1 ? "event" : "events" }}
              <span v-if="step.rate !== null"> · {{ step.rate }} of previous step</span>
            </p>
          </div>
        </div>

        <p class="mt-4 text-sm text-gray-500">
          Backed out at the confirmation step: <b>{{ canceled.toLocaleString() }}</b> ·
          refused as a downgrade: <b>{{ downgradeBlocked.toLocaleString() }}</b>
        </p>
      </section>

      <section v-if="byDay.length > 0" class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 class="text-lg font-semibold text-gray-900">Funnel by day</h2>
        <div class="mt-6 h-80">
          <Bar :data="chartData" :options="chartOptions" />
        </div>
      </section>

      <section
        v-for="table in breakdownTables"
        :key="table.title"
        class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h2 class="text-lg font-semibold text-gray-900">{{ table.title }}</h2>
        <p class="text-sm text-gray-500">{{ table.hint }}</p>
        <p v-if="table.rows.length === 0" class="mt-6 text-sm text-gray-500">Nothing recorded in this window.</p>
        <table v-else class="mt-6 w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th class="pb-2 font-medium">{{ table.columnLabel }}</th>
              <th class="pb-2 text-right font-medium" v-for="column in table.columns" :key="column.event">
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in table.rows" :key="row.context" class="border-b border-gray-100 last:border-0">
              <td class="py-2 font-medium text-gray-900">{{ row.context }}</td>
              <td v-for="column in table.columns" :key="column.event" class="py-2 text-right text-gray-700">
                <span v-if="row.cells[column.event]">
                  {{ row.cells[column.event]?.users.toLocaleString() }}
                  <span class="text-xs text-gray-400">({{ row.cells[column.event]?.count.toLocaleString() }})</span>
                </span>
                <span v-else class="text-gray-300">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
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
import { productMetrics, type ProductMetricsResponse } from "../lib/api";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const dayOptions = [7, 14, 30];
const days = ref(30);
const data = ref<ProductMetricsResponse | null>(null);
const loading = ref(true);
const error = ref("");

const totals = computed(() => new Map(data.value?.totals.map((row) => [row.event, row]) ?? []));
const byDay = computed(() => [...(data.value?.byDay ?? [])].reverse());
const isEmpty = computed(() => (data.value?.totals.length ?? 0) === 0);

const canceled = computed(() => totals.value.get("plan.canceled")?.count ?? 0);
const downgradeBlocked = computed(() => totals.value.get("plan.downgrade_blocked")?.count ?? 0);

/** `12 / 40` → `"30%"`; an empty previous step has no rate rather than a division by zero. */
function rateOf(users: number, previous: number): string | null {
  return previous > 0 ? `${Math.round((users / previous) * 100)}%` : null;
}

const FUNNEL_STEPS = [
  { event: "limit.reached", label: "Hit a limit", tone: "text-gray-900" },
  { event: "paywall.shown", label: "Saw the price list", tone: "text-gray-900" },
  { event: "plan.selected", label: "Picked a plan", tone: "text-amber-600" },
  { event: "plan.confirmed", label: "Paid", tone: "text-emerald-600" },
] as const;

/**
 * The rate is measured against the previous step's users, except for the first
 * two: hitting a limit is one of several ways to reach the price list, not a
 * gate in front of it, so treating it as the funnel's mouth would report a
 * conversion above 100%.
 */
const funnel = computed(() =>
  FUNNEL_STEPS.map((step, index) => {
    const row = totals.value.get(step.event);
    const previous = index >= 2 ? (totals.value.get(FUNNEL_STEPS[index - 1].event)?.users ?? 0) : 0;
    return {
      ...step,
      users: row?.users ?? 0,
      count: row?.count ?? 0,
      rate: index >= 2 ? rateOf(row?.users ?? 0, previous) : null,
    };
  }),
);

interface BreakdownCell {
  count: number;
  users: number;
}

/** Pivot the flat breakdown rows into one row per context, one column per event. */
function pivot(events: { event: string; label: string }[]) {
  const rows = new Map<string, Record<string, BreakdownCell>>();
  for (const row of data.value?.breakdown ?? []) {
    if (!events.some((column) => column.event === row.event)) {
      continue;
    }
    const cells = rows.get(row.context) ?? {};
    cells[row.event] = { count: row.count, users: row.users };
    rows.set(row.context, cells);
  }
  const total = (cells: Record<string, BreakdownCell>): number =>
    Object.values(cells).reduce((sum, cell) => sum + cell.count, 0);
  return [...rows.entries()]
    .map(([context, cells]) => ({ context, cells }))
    .sort((a, b) => total(b.cells) - total(a.cells));
}

const breakdownTables = computed(() => {
  const featureColumns = [
    { event: "feature.used", label: "Used" },
    { event: "feature.locked", label: "Blocked" },
  ];
  const paywallColumns = [{ event: "paywall.shown", label: "Opened" }];
  const planColumns = [
    { event: "plan.selected", label: "Picked" },
    { event: "plan.confirmed", label: "Paid" },
  ];
  const usageColumns = [
    { event: "command.used", label: "Commands" },
    { event: "mode.switched", label: "Mode switches" },
  ];
  const limitColumns = [{ event: "limit.reached", label: "Hit" }];

  return [
    {
      title: "Paid features",
      hint: "Distinct users, with total taps in parentheses. Blocked means the plan did not include it.",
      columnLabel: "Feature",
      columns: featureColumns,
      rows: pivot(featureColumns),
    },
    {
      title: "Plans",
      hint: "Which tier people pick, and which they actually pay for.",
      columnLabel: "Plan",
      columns: planColumns,
      rows: pivot(planColumns),
    },
    {
      title: "What opened the price list",
      hint: "A feature key means a paid button refused; cta is the upgrade button on a limit notice; settings is the menu entry.",
      columnLabel: "Origin",
      columns: paywallColumns,
      rows: pivot(paywallColumns),
    },
    {
      title: "Limits",
      hint: "Which ceiling people run into.",
      columnLabel: "Limit",
      columns: limitColumns,
      rows: pivot(limitColumns),
    },
    {
      title: "Commands and modes",
      hint: "Every slash command is counted; mode is the routing mode the chat switched into.",
      columnLabel: "Command / mode",
      columns: usageColumns,
      rows: pivot(usageColumns),
    },
  ];
});

const chartData = computed<ChartData<"bar">>(() => ({
  labels: byDay.value.map((row) => row.date),
  datasets: [
    {
      label: "Price list opened",
      data: byDay.value.map((row) => row.paywallShown),
      backgroundColor: "#93c5fd",
      borderRadius: 2,
    },
    {
      label: "Plan picked",
      data: byDay.value.map((row) => row.planSelected),
      backgroundColor: "#fbbf24",
      borderRadius: 2,
    },
    {
      label: "Paid",
      data: byDay.value.map((row) => row.planConfirmed),
      backgroundColor: "#34d399",
      borderRadius: 2,
    },
  ],
}));

const chartOptions: ChartOptions<"bar"> = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { ticks: { maxRotation: 35, minRotation: 0 } },
    y: { beginAtZero: true, title: { display: true, text: "Events" } },
  },
  plugins: { legend: { position: "bottom" } },
};

async function load(next = days.value): Promise<void> {
  days.value = next;
  loading.value = true;
  error.value = "";
  try {
    data.value = await productMetrics.get(next);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load product metrics";
  } finally {
    loading.value = false;
  }
}

onMounted(() => load());
</script>

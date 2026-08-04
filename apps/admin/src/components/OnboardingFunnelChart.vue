<template>
  <section class="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
    <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">Onboarding Funnel</h2>
        <p class="text-sm text-gray-500">Users by the furthest onboarding step reached, split by completion</p>
      </div>
      <button
        class="self-start rounded-md px-3 py-1 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 sm:self-auto"
        :disabled="loading"
        @click="load"
      >
        Refresh
      </button>
    </div>

    <p v-if="loading" class="mt-6 text-sm text-gray-400">Loading funnel...</p>
    <AlertMessage v-else-if="error">{{ error }}</AlertMessage>
    <p v-else-if="totalUsers === 0" class="mt-6 text-sm text-gray-400">No users yet</p>

    <div v-else class="mt-6 overflow-x-auto">
      <table class="min-w-max divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Step</th>
            <th class="px-4 py-3 text-right text-xs font-semibold tracking-wide text-gray-600 uppercase">Users</th>
            <th class="px-4 py-3 text-right text-xs font-semibold tracking-wide text-gray-600 uppercase">Onboarded</th>
            <th class="px-4 py-3 text-right text-xs font-semibold tracking-wide text-gray-600 uppercase">
              Not onboarded
            </th>
            <th class="w-64 px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Share</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="row in steps" :key="row.step" class="transition-colors hover:bg-gray-50">
            <td class="px-4 py-3 text-sm font-medium whitespace-nowrap text-gray-900">
              <span class="tabular-nums text-gray-400">{{ row.step }}</span>
              <span class="ml-2">{{ row.label }}</span>
            </td>
            <td class="px-4 py-3 text-right text-sm font-bold whitespace-nowrap text-gray-900 tabular-nums">
              {{ row.total.toLocaleString() }}
            </td>
            <td class="px-4 py-3 text-right text-sm whitespace-nowrap text-emerald-600 tabular-nums">
              {{ row.onboarded.toLocaleString() }}
            </td>
            <td class="px-4 py-3 text-right text-sm whitespace-nowrap text-amber-600 tabular-nums">
              {{ row.notOnboarded.toLocaleString() }}
            </td>
            <td class="px-4 py-3">
              <div class="flex h-3 w-56 overflow-hidden rounded-full bg-gray-100" :title="shareTitle(row)">
                <div class="bg-emerald-400" :style="{ width: `${percentOfAll(row.onboarded)}%` }"></div>
                <div class="bg-amber-400" :style="{ width: `${percentOfAll(row.notOnboarded)}%` }"></div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="totalUsers > 0 && !loading && !error" class="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
      <div class="rounded-lg border border-gray-200 px-4 py-3">
        <p class="text-xs font-medium text-gray-500">Total Users</p>
        <p class="mt-1 text-2xl font-semibold text-gray-900">{{ totalUsers.toLocaleString() }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 px-4 py-3">
        <p class="text-xs font-medium text-gray-500">Onboarded</p>
        <p class="mt-1 text-2xl font-semibold text-emerald-600">{{ totalOnboarded.toLocaleString() }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 px-4 py-3">
        <p class="text-xs font-medium text-gray-500">Completion Rate</p>
        <p class="mt-1 text-2xl font-semibold text-gray-900">{{ completionRate }}%</p>
      </div>
    </div>

    <p v-if="totalUsers > 0 && !loading && !error" class="mt-4 text-xs text-gray-400">
      Step 4 is the Task 72 completion step. Onboarded users still sitting on step 3 finished under the previous
      3-screen flow and were not backfilled.
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onboardingFunnel, type OnboardingFunnelRow } from "../lib/api";
import AlertMessage from "./ui/AlertMessage.vue";

/** Screen names for the Task 72 flow; unknown steps fall back to their number. */
const STEP_LABELS: Record<number, string> = {
  0: "Not started",
  1: "Native language",
  2: "Learning languages",
  3: "Demo card",
  4: "Complete",
};

interface FunnelStep {
  step: number;
  label: string;
  onboarded: number;
  notOnboarded: number;
  total: number;
}

const rows = ref<OnboardingFunnelRow[]>([]);
const loading = ref(true);
const error = ref("");

const steps = computed<FunnelStep[]>(() => {
  const byStep = new Map<number, FunnelStep>();
  for (const row of rows.value) {
    let entry = byStep.get(row.step);
    if (!entry) {
      entry = {
        step: row.step,
        label: STEP_LABELS[row.step] ?? `Step ${row.step}`,
        onboarded: 0,
        notOnboarded: 0,
        total: 0,
      };
      byStep.set(row.step, entry);
    }
    if (row.onboarded) {
      entry.onboarded += row.count;
    } else {
      entry.notOnboarded += row.count;
    }
    entry.total += row.count;
  }
  return Array.from(byStep.values()).sort((a, b) => a.step - b.step);
});

const totalUsers = computed(() => steps.value.reduce((sum, row) => sum + row.total, 0));
const totalOnboarded = computed(() => steps.value.reduce((sum, row) => sum + row.onboarded, 0));
const completionRate = computed(() =>
  totalUsers.value === 0 ? "0.0" : ((totalOnboarded.value / totalUsers.value) * 100).toFixed(1),
);

function percentOfAll(count: number): number {
  return totalUsers.value === 0 ? 0 : (count / totalUsers.value) * 100;
}

function shareTitle(row: FunnelStep): string {
  return `${row.onboarded} onboarded, ${row.notOnboarded} not onboarded`;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    rows.value = await onboardingFunnel.list();
  } catch {
    error.value = "Failed to load the onboarding funnel";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

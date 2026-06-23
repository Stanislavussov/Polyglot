<template>
  <div class="mt-6">
    <div class="mb-4 flex items-center gap-3">
      <label for="days-window" class="text-sm font-medium text-gray-700">Window</label>
      <select
        id="days-window"
        v-model.number="days"
        class="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option v-for="option in dayOptions" :key="option" :value="option">{{ option }} days</option>
      </select>
    </div>

    <AlertMessage v-if="error">{{ error }}</AlertMessage>
    <p v-else-if="loading" class="text-sm text-gray-400">Loading...</p>
    <p v-else-if="!data || data.users.length === 0" class="text-sm text-gray-400">No requests in this period</p>
    <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table class="min-w-max divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th
              class="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase whitespace-nowrap"
            >
              User
            </th>
            <th
              v-for="day in data.days"
              :key="day"
              :title="formatFullDate(day)"
              class="px-3 py-3 text-center text-xs font-semibold tracking-wide text-gray-600 uppercase whitespace-nowrap"
            >
              {{ formatDayHeader(day) }}
            </th>
            <th
              class="px-4 py-3 text-right text-xs font-semibold tracking-wide text-gray-600 uppercase whitespace-nowrap"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="user in data.users" :key="user.userId" class="transition-colors hover:bg-gray-50">
            <td class="sticky left-0 z-10 bg-white px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
              <div class="flex items-center gap-2">
                <span>{{ userLabel(user) }}</span>
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize"
                  :class="planClass(user.subscriptionPlan)"
                >
                  {{ user.subscriptionPlan }}
                </span>
              </div>
            </td>
            <td
              v-for="day in data.days"
              :key="day"
              class="px-3 py-3 text-center text-sm whitespace-nowrap tabular-nums"
              :class="cellClass(countFor(user, day))"
            >
              {{ countFor(user, day) }}
            </td>
            <td class="px-4 py-3 text-right text-sm font-bold text-gray-900 whitespace-nowrap tabular-nums">
              {{ user.total }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { requestStats, type UserRequestCount, type UserRequestCountsResponse } from "../lib/api";
import AlertMessage from "./ui/AlertMessage.vue";

const dayOptions = [7, 14, 30, 60, 90] as const;
const days = ref<number>(30);
const data = ref<UserRequestCountsResponse | null>(null);
const loading = ref(false);
const error = ref("");

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    data.value = await requestStats.getUserRequestCounts(days.value);
  } catch {
    error.value = "Failed to load request counts";
  } finally {
    loading.value = false;
  }
}

function userLabel(user: UserRequestCount): string {
  return user.username || `TG ${user.telegramId}`;
}

function countFor(user: UserRequestCount, day: string): number {
  return user.counts[day] ?? 0;
}

function formatDayHeader(day: string): string {
  return day.slice(5);
}

function formatFullDate(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function planClass(plan: string): string {
  if (plan === "pro") return "bg-indigo-100 text-indigo-800";
  if (plan === "unlimited") return "bg-amber-100 text-amber-800";
  if (plan === "plus") return "bg-emerald-100 text-emerald-800";
  return "bg-gray-100 text-gray-800";
}

function cellClass(count: number): string {
  if (count === 0) return "text-gray-300";
  if (count >= 20) return "bg-indigo-100 text-indigo-900";
  if (count >= 10) return "bg-indigo-50 text-indigo-800";
  if (count >= 5) return "bg-indigo-50/60 text-indigo-700";
  return "text-gray-700";
}

watch(days, () => {
  void load();
});

onMounted(() => {
  void load();
});
</script>
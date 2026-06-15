<template>
  <div class="mt-6">
    <div class="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
      <input
        v-model="search"
        type="text"
        placeholder="Search reports or users..."
        class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <select
        v-model="status"
        class="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">All statuses</option>
        <option value="open">Open</option>
        <option value="in_progress">In progress</option>
        <option value="resolved">Resolved</option>
        <option value="rejected">Rejected</option>
      </select>
    </div>

    <AlertMessage v-if="error" tone="error">{{ error }}</AlertMessage>
    <AlertMessage v-if="successMessage" tone="success">{{ successMessage }}</AlertMessage>
    <p v-else-if="!loading && list.length === 0" class="text-sm text-gray-400">No reports found</p>
    <p v-else-if="loading" class="text-sm text-gray-400">Loading...</p>
    <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table class="min-w-max divide-y divide-gray-200 sm:min-w-full">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Report</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">User</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Type</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Status</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Created</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="issue in list" :key="issue.id" class="transition-colors hover:bg-gray-50">
            <td class="max-w-xl px-4 py-3 text-sm text-gray-900">
              <p class="line-clamp-3 whitespace-normal break-words">{{ issue.description }}</p>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
              <div class="font-medium text-gray-900">{{ userLabel(issue) }}</div>
              <div class="text-xs text-gray-500">{{ issue.user.telegramId }}</div>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-sm">
              <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize" :class="typeClass(issue.type)">
                {{ typeLabel(issue.type) }}
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-sm">
              <select
                :value="issue.status"
                :disabled="updatingId === issue.id"
                class="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium capitalize shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                @change="handleStatusChange(issue, ($event.target as HTMLSelectElement).value as IssueStatus)"
              >
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
                <option value="rejected">Rejected</option>
              </select>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
              {{ formatDate(issue.createdAt) }}
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-sm">
              <button
                class="rounded-md px-3 py-1.5 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
                @click="openIssueDetail(issue)"
              >
                View
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <AppModal v-if="selectedIssue" title="Issue Details" size="lg" @close="selectedIssue = null">
      <div class="space-y-4">
        <div>
          <h3 class="text-sm font-semibold text-gray-700 uppercase">Description</h3>
          <p class="mt-1 whitespace-pre-wrap text-sm text-gray-900">{{ selectedIssue.description }}</p>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <h3 class="text-sm font-semibold text-gray-700 uppercase">User</h3>
            <p class="mt-1 text-sm text-gray-900">{{ userLabel(selectedIssue) }}</p>
            <p class="text-xs text-gray-500">Telegram ID: {{ selectedIssue.user.telegramId }}</p>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-gray-700 uppercase">Status</h3>
            <select
              :value="selectedIssue.status"
              :disabled="updatingId === selectedIssue.id"
              class="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium capitalize shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              @change="handleStatusChange(selectedIssue, ($event.target as HTMLSelectElement).value as IssueStatus)"
            >
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-gray-700 uppercase">Dates</h3>
            <p class="mt-1 text-xs text-gray-500">Created: {{ formatDate(selectedIssue.createdAt) }}</p>
            <p class="text-xs text-gray-500">Updated: {{ formatDate(selectedIssue.updatedAt) }}</p>
          </div>
        </div>
      </div>
    </AppModal>

    <div class="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex flex-wrap items-center gap-3 text-sm text-gray-500">
        <span>{{ resultsLabel }}</span>
        <label class="flex items-center gap-2">
          <span>Rows</span>
          <select
            v-model.number="pageSize"
            class="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option :value="20">20</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </label>
      </div>
      <div v-if="totalPages > 1" class="flex flex-wrap items-center gap-2">
        <button
          :disabled="currentPage === 1"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="goToPage(1)"
        >
          First
        </button>
        <button
          :disabled="currentPage === 1"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="goToPage(currentPage - 1)"
        >
          Prev
        </button>
        <button
          v-for="page in visiblePages"
          :key="page"
          class="h-9 min-w-9 rounded-md border px-3 text-sm font-medium shadow-sm transition-colors"
          :class="
            page === currentPage
              ? 'border-indigo-600 bg-indigo-600 text-white'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          "
          @click="goToPage(page)"
        >
          {{ page }}
        </button>
        <span class="flex items-center text-sm text-gray-700">Page {{ currentPage }} of {{ totalPages }}</span>
        <button
          :disabled="currentPage === totalPages"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="goToPage(currentPage + 1)"
        >
          Next
        </button>
        <button
          :disabled="currentPage === totalPages"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="goToPage(totalPages)"
        >
          Last
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { type IssueStatus, type IssueType, type ReportedIssue, reportedIssues } from "../lib/api";
import AlertMessage from "./ui/AlertMessage.vue";
import AppModal from "./ui/AppModal.vue";

const list = ref<ReportedIssue[]>([]);
const total = ref(0);
const currentPage = ref(1);
const search = ref("");
const status = ref<IssueStatus | "">("");
const loading = ref(false);
const error = ref("");
const pageSize = ref(20);
const selectedIssue = ref<ReportedIssue | null>(null);
const updatingId = ref<number | null>(null);
const successMessage = ref("");
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let successTimer: ReturnType<typeof setTimeout> | undefined;

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const firstResult = computed(() => (total.value === 0 ? 0 : (currentPage.value - 1) * pageSize.value + 1));
const lastResult = computed(() => Math.min(currentPage.value * pageSize.value, total.value));
const resultsLabel = computed(() => {
  if (total.value === 0) return "0 reports";
  return `${firstResult.value}-${lastResult.value} of ${total.value} report${total.value !== 1 ? "s" : ""}`;
});
const visiblePages = computed(() => {
  const pages: number[] = [];
  const start = Math.max(1, currentPage.value - 2);
  const end = Math.min(totalPages.value, currentPage.value + 2);

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  return pages;
});

async function loadIssues(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await reportedIssues.list(currentPage.value, pageSize.value, status.value, search.value.trim());
    list.value = data.issues;
    total.value = data.total;
  } catch {
    error.value = "Failed to load reports";
  } finally {
    loading.value = false;
  }
}

function userLabel(issue: ReportedIssue): string {
  return issue.user.username || `User #${issue.user.id}`;
}

function openIssueDetail(issue: ReportedIssue): void {
  selectedIssue.value = issue;
}

function handleStatusChange(issue: ReportedIssue, newStatus: IssueStatus): void {
  if (newStatus === issue.status) return;
  void updateIssueStatus(issue.id, newStatus);
}

async function updateIssueStatus(id: number, status: IssueStatus): Promise<void> {
  updatingId.value = id;
  error.value = "";
  successMessage.value = "";
  if (successTimer) clearTimeout(successTimer);
  try {
    const updated = await reportedIssues.updateStatus(id, status);
    const idx = list.value.findIndex((i) => i.id === id);
    if (idx !== -1) {
      list.value[idx] = { ...list.value[idx], status: updated.status, updatedAt: updated.updatedAt };
    }
    if (selectedIssue.value?.id === id) {
      selectedIssue.value = { ...selectedIssue.value, status: updated.status, updatedAt: updated.updatedAt };
    }
    successMessage.value = `Status updated to ${statusLabel(updated.status)}`;
    successTimer = setTimeout(() => {
      successMessage.value = "";
    }, 3000);
  } catch {
    error.value = "Failed to update status";
  } finally {
    updatingId.value = null;
  }
}

function typeLabel(type: IssueType): string {
  if (type === "bug") return "Bug";
  if (type === "suggestion") return "Suggestion";
  return "Other";
}

function statusLabel(value: IssueStatus): string {
  if (value === "in_progress") return "In progress";
  return value;
}

function typeClass(type: IssueType): string {
  if (type === "bug") return "bg-red-100 text-red-800";
  if (type === "suggestion") return "bg-emerald-100 text-emerald-800";
  return "bg-gray-100 text-gray-800";
}

function statusClass(value: IssueStatus): string {
  if (value === "open") return "bg-indigo-100 text-indigo-800";
  if (value === "in_progress") return "bg-amber-100 text-amber-800";
  if (value === "resolved") return "bg-emerald-100 text-emerald-800";
  return "bg-gray-100 text-gray-800";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function goToPage(page: number): void {
  currentPage.value = Math.min(Math.max(page, 1), totalPages.value);
}

function resetToFirstPageAndLoad(): void {
  if (currentPage.value === 1) {
    void loadIssues();
    return;
  }

  currentPage.value = 1;
}

watch(currentPage, () => {
  void loadIssues();
});

watch(pageSize, () => {
  resetToFirstPageAndLoad();
});

watch(status, () => {
  resetToFirstPageAndLoad();
});

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    resetToFirstPageAndLoad();
  }, 300);
});

onMounted(() => {
  void loadIssues();
});
</script>

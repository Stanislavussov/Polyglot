<template>
  <div class="mt-6">
    <div
      v-if="userId !== undefined"
      class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
    >
      <span>
        Showing notifications sent to <span class="font-semibold">{{ filteredUserLabel }}</span>
      </span>
      <AppButton variant="link" @click="setUserFilter(undefined)">Show all users</AppButton>
    </div>

    <div class="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
      <input
        v-model="search"
        type="text"
        placeholder="Search message text, username or Telegram ID..."
        class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <select
        v-model="kind"
        class="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">All kinds</option>
        <option v-for="option in kindOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
    </div>

    <AlertMessage v-if="error">{{ error }}</AlertMessage>
    <p v-else-if="loading" class="text-sm text-gray-400">Loading...</p>
    <p v-else-if="list.length === 0" class="text-sm text-gray-400">No notifications found</p>
    <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table class="min-w-max divide-y divide-gray-200 sm:min-w-full">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Sent</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">User</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Kind</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Message</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Opened</th>
            <th class="px-4 py-3 text-right text-xs font-semibold tracking-wide text-gray-600 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="delivery in list" :key="delivery.id" class="transition-colors hover:bg-gray-50">
            <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{{ formatDate(delivery.sentAt) }}</td>
            <td class="whitespace-nowrap px-4 py-3 text-sm">
              <button
                type="button"
                class="text-left font-medium text-gray-900 transition-colors hover:text-indigo-600"
                title="Show only this user"
                @click="setUserFilter(delivery.user.id)"
              >
                {{ userLabel(delivery) }}
              </button>
              <div class="text-xs text-gray-500">{{ delivery.user.telegramId }}</div>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-sm">
              <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" :class="kindClass(delivery.kind)">
                {{ kindLabel(delivery.kind) }}
              </span>
            </td>
            <td class="max-w-xl px-4 py-3 text-sm text-gray-900">
              <p class="line-clamp-3 whitespace-pre-line break-words">{{ plainText(delivery) }}</p>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-sm">
              <template v-if="delivery.openedAt">
                <span class="text-emerald-700">{{ formatDate(delivery.openedAt) }}</span>
                <div class="text-xs text-gray-500">{{ tapsLabel(delivery.interactionCount) }}</div>
              </template>
              <span v-else class="text-gray-400">—</span>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-right">
              <AppButton variant="link" @click="selected = delivery">View</AppButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <AppModal v-if="selected" :title="`${kindLabel(selected.kind)} → ${userLabel(selected)}`" size="lg" @close="selected = null">
      <div class="space-y-4">
        <div>
          <h3 class="text-sm font-semibold text-gray-700 uppercase">Message</h3>
          <p class="mt-1 whitespace-pre-wrap break-words rounded-md bg-gray-50 p-3 text-sm text-gray-900">{{ plainText(selected) }}</p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 class="text-sm font-semibold text-gray-700 uppercase">Sent</h3>
            <p class="mt-1 text-sm text-gray-900">{{ formatDate(selected.sentAt) }}</p>
            <p class="text-xs text-gray-500">Telegram ID: {{ selected.user.telegramId }}</p>
            <h3 class="mt-3 text-sm font-semibold text-gray-700 uppercase">Opened</h3>
            <p v-if="selected.openedAt" class="mt-1 text-sm text-gray-900">
              {{ formatDate(selected.openedAt) }} · {{ tapsLabel(selected.interactionCount) }}
            </p>
            <p v-else class="mt-1 text-sm text-gray-400">No button tapped yet</p>
          </div>
          <div v-if="selected.meta && Object.keys(selected.meta).length > 0">
            <h3 class="text-sm font-semibold text-gray-700 uppercase">Details</h3>
            <dl class="mt-1 space-y-0.5 text-sm">
              <div v-for="(value, key) in selected.meta" :key="key" class="flex gap-2">
                <dt class="text-gray-500">{{ key }}:</dt>
                <dd class="break-all text-gray-900">{{ value ?? "—" }}</dd>
              </div>
            </dl>
          </div>
        </div>
        <details v-if="selected.parseMode === 'HTML'">
          <summary class="cursor-pointer text-sm text-gray-500">Raw HTML as sent</summary>
          <pre class="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-gray-900 p-3 text-xs text-gray-100">{{ selected.text }}</pre>
        </details>
      </div>
    </AppModal>

    <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <span class="text-sm text-gray-500">{{ total }} notification{{ total !== 1 ? "s" : "" }}</span>
      <div v-if="totalPages > 1" class="flex flex-wrap items-center gap-2">
        <button
          :disabled="currentPage === 1"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="currentPage--"
        >
          Previous
        </button>
        <span class="flex items-center text-sm text-gray-700">Page {{ currentPage }} of {{ totalPages }}</span>
        <button
          :disabled="currentPage === totalPages"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="currentPage++"
        >
          Next
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { type NotificationDelivery, type NotificationDeliveryKind, notificationDeliveries } from "../lib/api";
import AlertMessage from "./ui/AlertMessage.vue";
import AppButton from "./ui/AppButton.vue";
import AppModal from "./ui/AppModal.vue";

const PAGE_SIZE = 50;

const list = ref<NotificationDelivery[]>([]);
const total = ref(0);
const currentPage = ref(1);
const search = ref("");
const kind = ref<NotificationDeliveryKind | "">("");
const userId = ref<number | undefined>(undefined);
const loading = ref(false);
const error = ref("");
const selected = ref<NotificationDelivery | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
// Filters fire requests independently; without this a slow earlier response lands last and shows the wrong filter.
let latestRequest = 0;

const kindOptions = [
  { value: "word_card", label: "Word card" },
  { value: "re_engagement", label: "Re-engagement" },
  { value: "dictionary_empty", label: "Empty dictionary" },
  { value: "activation_nudge", label: "Activation nudge" },
  { value: "trial", label: "Trial" },
  { value: "release_announcement", label: "Release announcement" },
] as const satisfies readonly { value: NotificationDeliveryKind; label: string }[];

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const filteredUserLabel = computed(() => {
  const first = list.value[0];
  return first ? userLabel(first) : `User #${userId.value}`;
});

async function loadDeliveries(): Promise<void> {
  const request = ++latestRequest;
  loading.value = true;
  error.value = "";
  try {
    const data = await notificationDeliveries.list(currentPage.value, PAGE_SIZE, {
      userId: userId.value,
      kind: kind.value,
      search: search.value.trim(),
    });
    if (request !== latestRequest) return;
    list.value = data.deliveries;
    total.value = data.total;
  } catch {
    if (request === latestRequest) error.value = "Failed to load notifications";
  } finally {
    if (request === latestRequest) loading.value = false;
  }
}

function readUserIdFromUrl(): number | undefined {
  const raw = new URLSearchParams(window.location.search).get("userId");
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Keeps `?userId=` in the address bar so a per-user view can be bookmarked and linked from Users. */
function setUserFilter(id: number | undefined): void {
  const url = new URL(window.location.href);
  if (id === undefined) url.searchParams.delete("userId");
  else url.searchParams.set("userId", String(id));
  window.history.replaceState(null, "", url);
  userId.value = id;
  resetToFirstPage();
}

function resetToFirstPage(): void {
  if (currentPage.value === 1) void loadDeliveries();
  else currentPage.value = 1;
}

/**
 * Message bodies carry user-derived words, so markup is never rendered as HTML.
 * DOMParser builds an inert document (no scripts run, no resources load), and
 * Telegram HTML keeps its line breaks as `\n`, so `textContent` reads as sent.
 */
function plainText(delivery: NotificationDelivery): string {
  if (delivery.parseMode !== "HTML") return delivery.text;
  return new DOMParser().parseFromString(delivery.text, "text/html").body.textContent ?? "";
}

function userLabel(delivery: NotificationDelivery): string {
  return delivery.user.username ? `@${delivery.user.username}` : `User #${delivery.user.id}`;
}

function kindLabel(value: NotificationDeliveryKind): string {
  return kindOptions.find((option) => option.value === value)?.label ?? value;
}

function kindClass(value: NotificationDeliveryKind): string {
  if (value === "word_card") return "bg-indigo-100 text-indigo-800";
  if (value === "re_engagement") return "bg-amber-100 text-amber-800";
  if (value === "trial") return "bg-emerald-100 text-emerald-800";
  if (value === "activation_nudge") return "bg-sky-100 text-sky-800";
  return "bg-gray-100 text-gray-800";
}

function tapsLabel(count: number): string {
  return `${count} tap${count !== 1 ? "s" : ""}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

watch(currentPage, () => {
  void loadDeliveries();
});

watch(kind, () => {
  resetToFirstPage();
});

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(resetToFirstPage, 300);
});

onMounted(() => {
  userId.value = readUserIdFromUrl();
  void loadDeliveries();
});
</script>

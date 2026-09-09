<template>
  <div class="mt-6">
    <div class="mb-4 grid gap-3 sm:grid-cols-3">
      <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <p class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Cached</p>
        <p class="mt-1 text-2xl font-bold text-gray-900">{{ counts.cached }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <p class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Servable</p>
        <p class="mt-1 text-2xl font-bold text-green-700">{{ counts.active }}</p>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <p class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Awaiting review</p>
        <p class="mt-1 text-2xl font-bold" :class="backlog > 0 ? 'text-amber-600' : 'text-gray-900'">{{ backlog }}</p>
      </div>
    </div>

    <AlertMessage v-if="backlog > 0 && counts.active === 0" tone="info">
      No card is approved yet, so every hook tap in onboarding falls through to a live translation — slow and paid.
      Approve the cards below to make them servable.
    </AlertMessage>

    <div class="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
      <input
        v-model="search"
        type="text"
        placeholder="Search headwords..."
        class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <select
        v-model="activeFilter"
        class="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">All cards</option>
        <option value="false">Awaiting review</option>
        <option value="true">Approved</option>
      </select>
    </div>

    <AlertMessage v-if="error" tone="error">{{ error }}</AlertMessage>
    <AlertMessage v-if="successMessage" tone="success">{{ successMessage }}</AlertMessage>

    <p v-if="loading" class="text-sm text-gray-400">Loading...</p>
    <p v-else-if="cards.length === 0" class="text-sm text-gray-400">
      No cards cached yet — run <code class="rounded bg-gray-100 px-1">pnpm demo-cards:warm</code> to generate them.
    </p>
    <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table class="min-w-max divide-y divide-gray-200 sm:min-w-full">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Headword</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Pair</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Card</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Status</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="card in cards" :key="card.id" class="transition-colors hover:bg-gray-50">
            <td class="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{{ card.headword }}</td>
            <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
              {{ card.sourceLang }} → {{ card.nativeLang }}
            </td>
            <td class="max-w-xl px-4 py-3 text-sm text-gray-700">
              <p class="line-clamp-2 whitespace-normal break-words">{{ preview(card) }}</p>
              <button
                class="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-500"
                @click="selectedCard = card"
              >
                Read full card
              </button>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-sm">
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                :class="card.isActive ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'"
              >
                {{ card.isActive ? "Approved" : "Awaiting review" }}
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-sm">
              <button
                :disabled="updatingId === card.id"
                class="rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                :class="
                  card.isActive
                    ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    : 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500'
                "
                @click="toggleActive(card)"
              >
                {{ card.isActive ? "Un-approve" : "Approve" }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <AppModal v-if="selectedCard" :title="selectedCard.headword" @close="selectedCard = null">
      <p class="text-xs text-gray-500">{{ selectedCard.sourceLang }} → {{ selectedCard.nativeLang }}</p>
      <pre
        class="mt-3 max-h-96 overflow-auto rounded-md bg-gray-50 p-3 text-xs whitespace-pre-wrap text-gray-800"
        >{{ JSON.stringify(selectedCard.payload, null, 2) }}</pre
      >
    </AppModal>

    <div class="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-500">
      <span>{{ resultsLabel }}</span>
      <div v-if="totalPages > 1" class="flex items-center gap-2">
        <button
          :disabled="currentPage === 1"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="goToPage(currentPage - 1)"
        >
          Prev
        </button>
        <span class="text-gray-700">Page {{ currentPage }} of {{ totalPages }}</span>
        <button
          :disabled="currentPage === totalPages"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="goToPage(currentPage + 1)"
        >
          Next
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { type OnboardingDemoCard, onboardingDemoCards } from "../lib/api";
import AlertMessage from "./ui/AlertMessage.vue";
import AppModal from "./ui/AppModal.vue";

const cards = ref<OnboardingDemoCard[]>([]);
const counts = ref({ cached: 0, active: 0 });
const total = ref(0);
const currentPage = ref(1);
const pageSize = 20;
const search = ref("");
const activeFilter = ref<"true" | "false" | "">("");
const loading = ref(false);
const error = ref("");
const successMessage = ref("");
const updatingId = ref<number | null>(null);
const selectedCard = ref<OnboardingDemoCard | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let successTimer: ReturnType<typeof setTimeout> | undefined;

/** Cards that cost an AI call to generate but that the bot still cannot serve. */
const backlog = computed(() => Math.max(0, counts.value.cached - counts.value.active));
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const resultsLabel = computed(() => {
  if (total.value === 0) return "0 cards";
  const first = (currentPage.value - 1) * pageSize + 1;
  const last = Math.min(currentPage.value * pageSize, total.value);
  return `${first}-${last} of ${total.value} card${total.value !== 1 ? "s" : ""}`;
});

/** The most human-readable line of the stored payload, for an at-a-glance scan. */
function preview(card: OnboardingDemoCard): string {
  const usage = card.payload.sourceUsage as { explanation?: string } | undefined;
  if (usage?.explanation) return usage.explanation;
  const translations = card.payload.translations as Record<string, { text?: string }> | undefined;
  const first = translations ? Object.values(translations)[0] : undefined;
  return first?.text ?? "(no readable text in payload)";
}

async function loadCards(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await onboardingDemoCards.list(currentPage.value, pageSize, activeFilter.value, search.value.trim());
    cards.value = data.cards;
    total.value = data.total;
    counts.value = data.counts;
  } catch {
    error.value = "Failed to load demo cards";
  } finally {
    loading.value = false;
  }
}

async function toggleActive(card: OnboardingDemoCard): Promise<void> {
  updatingId.value = card.id;
  error.value = "";
  try {
    await onboardingDemoCards.setActive(card, !card.isActive);
    showSuccess(`${card.headword} ${card.isActive ? "un-approved" : "approved"}`);
    await loadCards();
  } catch {
    error.value = `Failed to update ${card.headword}`;
  } finally {
    updatingId.value = null;
  }
}

function showSuccess(message: string): void {
  successMessage.value = message;
  clearTimeout(successTimer);
  successTimer = setTimeout(() => {
    successMessage.value = "";
  }, 3000);
}

function goToPage(page: number): void {
  currentPage.value = Math.min(Math.max(1, page), totalPages.value);
}

watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentPage.value = 1;
    void loadCards();
  }, 300);
});

watch([activeFilter], () => {
  currentPage.value = 1;
  void loadCards();
});

watch(currentPage, () => {
  void loadCards();
});

onMounted(loadCards);
</script>

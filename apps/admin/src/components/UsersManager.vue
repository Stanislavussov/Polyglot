<template>
  <div class="mt-6">
    <div class="mb-4">
      <input
        v-model="search"
        type="text"
        placeholder="Search by username..."
        class="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>

    <AlertMessage v-if="error">{{ error }}</AlertMessage>
    <p v-else-if="!loading && list.length === 0" class="text-sm text-gray-400">No users found</p>
    <p v-else-if="loading" class="text-sm text-gray-400">Loading...</p>
    <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table class="min-w-max divide-y divide-gray-200 sm:min-w-full">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">User</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Telegram ID</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Audience Group</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Plan</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Languages</th>
            <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Joined</th>
            <th class="px-4 py-3 text-right text-xs font-semibold tracking-wide text-gray-600 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="user in list" :key="user.id" class="transition-colors hover:bg-gray-50">
            <td class="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{{ userLabel(user) }}</td>
            <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{{ user.telegramId }}</td>
            <td class="whitespace-nowrap px-4 py-3 text-sm">
              <select
                :value="user.audienceGroup"
                class="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm capitalize text-gray-700 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-wait disabled:opacity-60"
                :disabled="audienceUpdatingId === user.id"
                @change="updateAudienceGroup(user, $event)"
              >
                <option v-for="option in audienceGroupOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-sm">
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize"
                :class="planClass(user.subscriptionPlan)"
              >
                {{ user.subscriptionPlan }}
              </span>
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{{ languageLabel(user) }}</td>
            <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
              {{ new Date(user.createdAt).toLocaleDateString() }}
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-right">
              <AppButton variant="link" @click="openPlan(user)">
                Change Plan
              </AppButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <span class="text-sm text-gray-500">{{ total }} user{{ total !== 1 ? "s" : "" }}</span>
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

    <AppModal v-if="planUser" size="sm" @close="closePlan">
        <h2 class="text-lg font-semibold text-gray-900">Change Plan</h2>
        <p class="mt-1 text-sm text-gray-500">
          Change plan for <span class="font-medium text-gray-700">{{ userLabel(planUser) }}</span>
        </p>
        <form class="mt-4 space-y-4" @submit.prevent="savePlan">
          <SelectField id="plan-select" v-model="selectedPlan" label="Plan" name="plan" :options="planOptions" />
          <AlertMessage v-if="planError">{{ planError }}</AlertMessage>
          <div class="flex justify-end gap-3">
            <AppButton variant="secondary" @click="closePlan">
              Cancel
            </AppButton>
            <AppButton type="submit">
              Update Plan
            </AppButton>
          </div>
        </form>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { type AudienceGroup, type PlanLimitConfig, type User, rateLimits, users } from "../lib/api";
import { audienceGroupSchema, subscriptionPlanSchema, zodErrorMessage } from "@polyglot/admin-contracts";
import AlertMessage from "./ui/AlertMessage.vue";
import AppButton from "./ui/AppButton.vue";
import AppModal from "./ui/AppModal.vue";
import SelectField from "./ui/SelectField.vue";

const list = ref<User[]>([]);
const total = ref(0);
const currentPage = ref(1);
const search = ref("");
const loading = ref(false);
const error = ref("");
const planUser = ref<User | null>(null);
const selectedPlan = ref("");
const planError = ref("");
const plans = ref<PlanLimitConfig[]>([]);
const audienceUpdatingId = ref<number | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / 20)));
const planOptions = computed(() =>
  plans.value.filter((plan) => plan.isActive).map((plan) => ({ value: plan.name, label: plan.label })),
);
const audienceGroupOptions = [
  { value: "admin", label: "Admin" },
  { value: "tester", label: "Tester" },
  { value: "product", label: "Product" },
] as const satisfies readonly { value: AudienceGroup; label: string }[];

async function loadUsers(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await users.list(currentPage.value, 20, search.value.trim());
    list.value = data.users;
    total.value = data.total;
  } catch {
    error.value = "Failed to load users";
  } finally {
    loading.value = false;
  }
}

async function loadPlans(): Promise<void> {
  try {
    plans.value = await rateLimits.list();
  } catch {
    planError.value = "Failed to load plans";
  }
}

function userLabel(user: User): string {
  return user.username || `User #${user.id}`;
}

function languageLabel(user: User): string {
  const langs = [user.nativeLang, ...(user.learningLangs || [])].filter(Boolean);
  return langs.length > 0 ? langs.join(" -> ") : "-";
}

function planClass(plan: string): string {
  if (plan === "pro") return "bg-indigo-100 text-indigo-800";
  if (plan === "unlimited") return "bg-amber-100 text-amber-800";
  if (plan === "plus") return "bg-emerald-100 text-emerald-800";
  return "bg-gray-100 text-gray-800";
}

function openPlan(user: User): void {
  planUser.value = user;
  selectedPlan.value = user.subscriptionPlan;
  planError.value = "";
}

function closePlan(): void {
  planUser.value = null;
  planError.value = "";
}

async function savePlan(): Promise<void> {
  if (!planUser.value) return;
  const parsed = subscriptionPlanSchema.safeParse(selectedPlan.value);
  if (!parsed.success) {
    planError.value = zodErrorMessage(parsed.error);
    return;
  }
  try {
    await users.changePlan(planUser.value.id, parsed.data);
    closePlan();
    await loadUsers();
  } catch (err) {
    planError.value = err instanceof Error ? err.message : "Failed to update plan";
  }
}

async function updateAudienceGroup(user: User, event: Event): Promise<void> {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement)) return;

  const parsed = audienceGroupSchema.safeParse(select.value);
  if (!parsed.success) {
    select.value = user.audienceGroup;
    error.value = zodErrorMessage(parsed.error);
    return;
  }

  const previous = user.audienceGroup;
  if (parsed.data === previous) return;

  audienceUpdatingId.value = user.id;
  error.value = "";
  user.audienceGroup = parsed.data;
  try {
    await users.changeAudienceGroup(user.id, parsed.data);
  } catch {
    user.audienceGroup = previous;
    select.value = previous;
    error.value = "Failed to update audience group";
  } finally {
    audienceUpdatingId.value = null;
  }
}

watch(currentPage, () => {
  void loadUsers();
});

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentPage.value = 1;
    void loadUsers();
  }, 300);
});

onMounted(() => {
  void loadUsers();
  void loadPlans();
});
</script>

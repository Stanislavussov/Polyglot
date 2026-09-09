<template>
  <div>
    <div class="mb-4 flex justify-end">
      <AppButton @click="openCreate">Add Plan</AppButton>
    </div>

    <DataTable :columns="columns" :rows="rows">
      <template #cell-name="{ row }">
        <span class="font-medium text-gray-900">{{ row.name }}</span>
      </template>
      <template #cell-translationLimit="{ value }">
        <span>{{ value == null ? "Unlimited" : value }}</span>
      </template>
      <template #cell-videoLimit="{ value }">
        <span>{{ value == null ? "Unlimited" : value }}</span>
      </template>
      <template #cell-mentorDailyLimit="{ value }">
        <span>{{ value == null ? "Unlimited" : value }}</span>
      </template>
      <template #cell-videoWindow="{ value }">
        <span>{{ value }}</span>
      </template>
      <template #cell-price="{ value }">
        <span>{{ value == null ? "—" : formatPrice(Number(value)) }}</span>
      </template>
      <template #cell-features="{ row }">
        <span v-if="!(row.features as string[])?.length" class="text-gray-400">—</span>
        <span v-else class="flex flex-wrap gap-1">
          <span
            v-for="key in (row.features as string[])"
            :key="key"
            class="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"
          >
            {{ key }}
          </span>
        </span>
      </template>
      <template #cell-isDefault="{ value }">
        <span
          v-if="value"
          class="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800"
        >
          Default
        </span>
      </template>
      <template #cell-isActive="{ value }">
        <span
          class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
          :class="value ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-800'"
        >
          {{ value ? "Active" : "Inactive" }}
        </span>
      </template>
      <template #cell-actions="{ row }">
        <div class="flex justify-end gap-3">
          <button class="font-medium text-indigo-600 hover:text-indigo-800" @click="openEdit(row.name)">Edit</button>
          <button
            class="font-medium text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:text-gray-400"
            :disabled="Boolean(row.isDefault)"
            @click="deletingName = String(row.name)"
          >
            Delete
          </button>
        </div>
      </template>
    </DataTable>
    <AlertMessage v-if="error" class="mt-4" type="error" :message="error" />

    <AppModal :open="showForm" :title="editingName === null ? 'Add Plan' : 'Edit Plan'" @close="closeForm">
      <form class="space-y-4" @submit.prevent="save">
        <AlertMessage v-if="formError" type="error" :message="formError" />
        <FormField id="plan-name" v-model="form.name" label="Name" name="name" required :readonly="editingName !== null" />
        <FormField id="plan-label" v-model="form.label" label="Label" name="label" required />
        <FormField
          id="plan-translations"
          v-model="form.translationLimit"
          label="Translations / month"
          name="translationLimit"
          placeholder="Leave empty for unlimited"
        />
        <FormField id="plan-cost" v-model="form.creditCost" type="number" label="Credit cost" name="creditCost" required />
        <FormField
          id="plan-video-limit"
          v-model="form.videoLimit"
          label="Video limit"
          name="videoLimit"
          placeholder="Leave empty for unlimited"
        />
        <FormField
          id="plan-mentor-daily-limit"
          v-model="form.mentorDailyLimit"
          label="Mentor turns / day"
          name="mentorDailyLimit"
          placeholder="Leave empty for unlimited"
        />
        <FormField
          id="plan-price"
          v-model="form.priceUsdCents"
          label="Price, US cents / month"
          name="priceUsdCents"
          placeholder="Leave empty if the plan is not for sale (500 = $5)"
        />
        <label class="block">
          <span class="mb-1 block text-sm font-medium text-gray-700">Video window</span>
          <select
            v-model="form.videoWindow"
            class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          >
            <option value="none">none (disabled)</option>
            <option value="lifetime">lifetime</option>
            <option value="monthly">monthly</option>
          </select>
        </label>
        <fieldset>
          <legend class="mb-1 block text-sm font-medium text-gray-700">Unlocks</legend>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1">
            <CheckboxField
              v-for="key in FEATURE_OPTIONS"
              :key="key"
              :label="key"
              :model-value="form.features.includes(key)"
              @update:model-value="toggleFeature(key)"
            />
          </div>
        </fieldset>
        <div class="flex gap-6">
          <CheckboxField v-model="form.isActive" label="Active" />
          <CheckboxField v-model="form.isDefault" label="Default" />
        </div>
        <div class="flex justify-end gap-3 pt-2">
          <AppButton type="button" variant="secondary" @click="closeForm">Cancel</AppButton>
          <AppButton type="submit">Save</AppButton>
        </div>
      </form>
    </AppModal>

    <AppModal :open="deletingName !== null" title="Delete Plan" @close="deletingName = null">
      <p class="text-sm text-gray-600">Users on this plan will move to the default plan.</p>
      <div class="mt-6 flex justify-end gap-3">
        <AppButton variant="secondary" @click="deletingName = null">Cancel</AppButton>
        <AppButton variant="danger" @click="deletePlan">Delete</AppButton>
      </div>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { type PlanLimitConfig, rateLimits } from "../lib/api";
import { featureKeySchema, rateLimitPlanSchema, zodErrorMessage } from "@polyglot/admin-contracts";
import DataTable, { type Column, type TableCellValue, type TableRow } from "./DataTable.vue";
import AlertMessage from "./ui/AlertMessage.vue";
import AppButton from "./ui/AppButton.vue";
import AppModal from "./ui/AppModal.vue";
import CheckboxField from "./ui/CheckboxField.vue";
import FormField from "./ui/FormField.vue";

interface PlanForm {
  name: string;
  label: string;
  translationLimit: string;
  creditCost: number;
  videoLimit: string;
  videoWindow: "none" | "lifetime" | "monthly";
  mentorDailyLimit: string;
  /** Entered in cents so the stored value is exact; empty means "not for sale". */
  priceUsdCents: string;
  isActive: boolean;
  isDefault: boolean;
  /**
   * Carried through the form untouched. The plan → model routing is edited on the
   * AI Models page; the upsert body is the whole plan, so dropping this field here
   * would silently reset the plan to the default model on every unrelated edit.
   */
  aiModelId: string | null;
  features: string[];
}

/** Canonical checkbox order — the contract enum, so new keys appear without a UI edit. */
const FEATURE_OPTIONS = featureKeySchema.options;

const columns: Column[] = [
  { key: "name", label: "Plan" },
  { key: "label", label: "Label" },
  { key: "translationLimit", label: "Translations/mo" },
  { key: "videoLimit", label: "Videos" },
  { key: "videoWindow", label: "Video window" },
  { key: "mentorDailyLimit", label: "Mentor/day" },
  { key: "price", label: "Price" },
  { key: "features", label: "Unlocks" },
  { key: "creditCost", label: "Credit Cost" },
  { key: "isDefault", label: "Default" },
  { key: "isActive", label: "Status" },
  { key: "actions", label: "Actions" },
];

const plans = ref<PlanLimitConfig[]>([]);
const error = ref("");
const formError = ref("");
const showForm = ref(false);
const editingName = ref<string | null>(null);
const deletingName = ref<string | null>(null);
const form = ref<PlanForm>(emptyForm());

const rows = computed<TableRow[]>(() =>
  plans.value.map((plan) => ({ ...plan, price: plan.priceUsdCents, actions: plan.name })),
);

/** `500` → `$5`, `1050` → `$10.50` — the same shape the bot shows on the upgrade screen. */
function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

function emptyForm(): PlanForm {
  return {
    name: "",
    label: "",
    translationLimit: "",
    creditCost: 1,
    videoLimit: "",
    videoWindow: "none",
    mentorDailyLimit: "",
    priceUsdCents: "",
    isActive: true,
    isDefault: false,
    aiModelId: null,
    features: [],
  };
}

function toggleFeature(key: string): void {
  const selected = new Set(form.value.features);
  if (selected.has(key)) {
    selected.delete(key);
  } else {
    selected.add(key);
  }
  form.value.features = FEATURE_OPTIONS.filter((option) => selected.has(option));
}

function toForm(plan: PlanLimitConfig): PlanForm {
  return {
    name: plan.name,
    label: plan.label,
    translationLimit: plan.translationLimit === null ? "" : String(plan.translationLimit),
    creditCost: plan.creditCost,
    videoLimit: plan.videoLimit === null ? "" : String(plan.videoLimit),
    videoWindow: plan.videoWindow,
    mentorDailyLimit: plan.mentorDailyLimit === null ? "" : String(plan.mentorDailyLimit),
    priceUsdCents: plan.priceUsdCents === null ? "" : String(plan.priceUsdCents),
    isActive: plan.isActive,
    isDefault: plan.isDefault,
    aiModelId: plan.aiModelId,
    // Drop keys the contract no longer knows: carrying one through would make
    // the zod parse reject the whole form until the admin touched a checkbox.
    features: (plan.features ?? []).filter((key) => (FEATURE_OPTIONS as readonly string[]).includes(key)),
  };
}

function toPlan(value: PlanForm): PlanLimitConfig {
  return {
    name: value.name.trim(),
    label: value.label.trim(),
    translationLimit: value.translationLimit.trim() === "" ? null : Number(value.translationLimit),
    creditCost: value.creditCost,
    videoLimit: value.videoLimit.trim() === "" ? null : Number(value.videoLimit),
    videoWindow: value.videoWindow,
    mentorDailyLimit: value.mentorDailyLimit.trim() === "" ? null : Number(value.mentorDailyLimit),
    priceUsdCents: value.priceUsdCents.trim() === "" ? null : Number(value.priceUsdCents),
    isActive: value.isActive,
    isDefault: value.isDefault,
    aiModelId: value.aiModelId,
    features: value.features,
  };
}

async function loadPlans(): Promise<void> {
  try {
    plans.value = await rateLimits.list();
  } catch {
    error.value = "Failed to load rate limits";
  }
}

function openCreate(): void {
  editingName.value = null;
  form.value = emptyForm();
  formError.value = "";
  showForm.value = true;
}

function openEdit(name: TableCellValue): void {
  const plan = plans.value.find((item) => item.name === name);
  if (!plan) return;
  editingName.value = plan.name;
  form.value = toForm(plan);
  formError.value = "";
  showForm.value = true;
}

function closeForm(): void {
  showForm.value = false;
  formError.value = "";
}

async function save(): Promise<void> {
  formError.value = "";
  const parsed = rateLimitPlanSchema.safeParse(toPlan(form.value));
  if (!parsed.success) {
    formError.value = zodErrorMessage(parsed.error);
    return;
  }

  try {
    await rateLimits.update(parsed.data);
    closeForm();
    await loadPlans();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "Failed to save plan";
  }
}

async function deletePlan(): Promise<void> {
  if (!deletingName.value) return;
  try {
    await rateLimits.delete(deletingName.value);
    deletingName.value = null;
    await loadPlans();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to delete plan";
  }
}

onMounted(() => {
  void loadPlans();
});
</script>

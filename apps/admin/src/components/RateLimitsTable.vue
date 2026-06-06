<template>
  <div>
    <div class="mb-4 flex justify-end">
      <AppButton @click="openCreate">Add Plan</AppButton>
    </div>

    <DataTable :columns="columns" :rows="rows">
      <template #cell-name="{ row }">
        <span class="font-medium text-gray-900">{{ row.name }}</span>
      </template>
      <template #cell-creditsPerDay="{ value }">
        <span>{{ value == null ? "Unlimited" : value }}</span>
      </template>
      <template #cell-windowMs="{ value }">
        <span>{{ formatWindow(value) }}</span>
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
          id="plan-credits"
          v-model="form.creditsPerDay"
          label="Credits per day"
          name="creditsPerDay"
          placeholder="Leave empty for unlimited"
        />
        <FormField id="plan-window" v-model="form.windowMs" type="number" label="Window, ms" name="windowMs" required />
        <FormField id="plan-cost" v-model="form.creditCost" type="number" label="Credit cost" name="creditCost" required />
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
import { rateLimitPlanSchema, zodErrorMessage } from "../lib/validation";
import DataTable, { type Column, type TableCellValue, type TableRow } from "./DataTable.vue";
import AlertMessage from "./ui/AlertMessage.vue";
import AppButton from "./ui/AppButton.vue";
import AppModal from "./ui/AppModal.vue";
import CheckboxField from "./ui/CheckboxField.vue";
import FormField from "./ui/FormField.vue";

interface PlanForm {
  name: string;
  label: string;
  creditsPerDay: string;
  windowMs: number;
  creditCost: number;
  isActive: boolean;
  isDefault: boolean;
}

const columns: Column[] = [
  { key: "name", label: "Plan" },
  { key: "label", label: "Label" },
  { key: "creditsPerDay", label: "Credits/Day" },
  { key: "windowMs", label: "Window" },
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

const rows = computed<TableRow[]>(() => plans.value.map((plan) => ({ ...plan, actions: plan.name })));

function emptyForm(): PlanForm {
  return {
    name: "",
    label: "",
    creditsPerDay: "",
    windowMs: 86_400_000,
    creditCost: 1,
    isActive: true,
    isDefault: false,
  };
}

function toForm(plan: PlanLimitConfig): PlanForm {
  return {
    name: plan.name,
    label: plan.label,
    creditsPerDay: plan.creditsPerDay === null ? "" : String(plan.creditsPerDay),
    windowMs: plan.windowMs,
    creditCost: plan.creditCost,
    isActive: plan.isActive,
    isDefault: plan.isDefault,
  };
}

function toPlan(value: PlanForm): PlanLimitConfig {
  return {
    name: value.name.trim(),
    label: value.label.trim(),
    creditsPerDay: value.creditsPerDay.trim() === "" ? null : Number(value.creditsPerDay),
    windowMs: value.windowMs,
    creditCost: value.creditCost,
    isActive: value.isActive,
    isDefault: value.isDefault,
  };
}

function formatWindow(value: TableCellValue): string {
  if (typeof value !== "number") {
    return "-";
  }
  const hours = value / 3_600_000;
  if (Number.isInteger(hours)) {
    return `${hours}h`;
  }
  return `${value}ms`;
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

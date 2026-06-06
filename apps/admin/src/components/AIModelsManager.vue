<template>
  <div>
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">AI Models</h1>
        <p class="mt-1 text-sm text-gray-500">Manage available AI models and set the default</p>
      </div>
      <AppButton @click="openAdd">Add Model</AppButton>
    </div>

    <div class="mt-6">
      <AlertMessage v-if="error" type="error" :message="error" />
      <p v-else-if="loading" class="text-sm text-gray-400">Loading...</p>
      <p v-else-if="models.length === 0" class="text-sm text-gray-400">No models configured</p>
      <div v-else class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Model</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Provider</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Max Tokens</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Cost In</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Cost Out</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Plans</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Status</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Default</th>
              <th class="px-4 py-3 text-right text-xs font-semibold tracking-wide text-gray-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="model in models" :key="model.id" class="transition-colors hover:bg-gray-50">
              <td class="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{{ model.name }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{{ model.provider }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{{ model.maxTokens.toLocaleString() }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                {{ formatCost(model.costPer1kInput) }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                {{ formatCost(model.costPer1kOutput) }}
              </td>
              <td class="max-w-48 px-4 py-3 text-sm text-gray-700">{{ formatPlans(model.allowedPlans) }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-sm">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="model.isEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-800'"
                >
                  {{ model.isEnabled ? "Enabled" : "Disabled" }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-sm">
                <span
                  v-if="model.isDefault"
                  class="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                >
                  Default
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right text-sm space-x-2">
                <button
                  v-if="!model.isDefault"
                  class="font-medium text-indigo-600 hover:text-indigo-800"
                  @click="setDefault(model.id)"
                >
                  Set Default
                </button>
                <button class="font-medium text-red-600 hover:text-red-800" @click="deletingId = model.id">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <AppModal :open="showForm" title="Add Model" @close="closeForm">
      <form class="space-y-4" @submit.prevent="save">
        <AlertMessage v-if="formError" type="error" :message="formError" />
        <AlertMessage v-if="openRouterError" type="error" :message="openRouterError" />

        <p v-if="openRouterLoading" class="text-sm text-gray-400">Loading OpenRouter models...</p>
        <AlertMessage
          v-else-if="availableOpenRouterModels.length === 0"
          type="info"
          message="No new OpenRouter models are available to add."
        />
        <ComboboxField
          v-else
          id="ai-model-id"
          v-model="selectedModelId"
          label="OpenRouter model"
          placeholder="Search by model name or id..."
          :options="modelOptions"
        />

        <dl v-if="selectedOpenRouterModel" class="grid grid-cols-2 gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
          <div>
            <dt class="font-medium text-gray-500">Provider</dt>
            <dd class="mt-1 text-gray-900">{{ selectedOpenRouterModel.provider }}</dd>
          </div>
          <div>
            <dt class="font-medium text-gray-500">Purpose</dt>
            <dd class="mt-1 text-gray-900">{{ selectedOpenRouterModel.purpose }}</dd>
          </div>
          <div>
            <dt class="font-medium text-gray-500">Max Tokens</dt>
            <dd class="mt-1 text-gray-900">{{ selectedOpenRouterModel.maxTokens.toLocaleString() }}</dd>
          </div>
          <div>
            <dt class="font-medium text-gray-500">Cost In</dt>
            <dd class="mt-1 text-gray-900">{{ formatCost(selectedOpenRouterModel.costPer1kInput) }}</dd>
          </div>
          <div>
            <dt class="font-medium text-gray-500">Cost Out</dt>
            <dd class="mt-1 text-gray-900">{{ formatCost(selectedOpenRouterModel.costPer1kOutput) }}</dd>
          </div>
        </dl>
        <div v-if="planOptions.length > 0" class="space-y-2">
          <p class="text-sm font-medium text-gray-700">Subscription Plans</p>
          <div class="grid grid-cols-2 gap-2">
            <CheckboxField
              v-for="plan in planOptions"
              :key="plan.value"
              :model-value="selectedAllowedPlans.includes(plan.value)"
              :label="plan.label"
              @update:model-value="togglePlan(plan.value, $event)"
            />
          </div>
        </div>

        <div class="flex justify-end gap-3 pt-2">
          <AppButton type="button" variant="secondary" @click="closeForm">Cancel</AppButton>
          <AppButton type="submit" :disabled="saveDisabled">Save</AppButton>
        </div>
      </form>
    </AppModal>

    <AppModal :open="deletingId !== null" title="Delete Model" @close="deletingId = null">
      <p class="text-sm text-gray-600">Are you sure you want to delete this model? This action cannot be undone.</p>
      <div class="mt-6 flex justify-end gap-3">
        <AppButton variant="secondary" @click="deletingId = null">Cancel</AppButton>
        <AppButton variant="danger" @click="deleteModel">Delete</AppButton>
      </div>
    </AppModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import AlertMessage from "./ui/AlertMessage.vue";
import AppButton from "./ui/AppButton.vue";
import AppModal from "./ui/AppModal.vue";
import CheckboxField from "./ui/CheckboxField.vue";
import ComboboxField, { type ComboboxOption } from "./ui/ComboboxField.vue";
import { type AIModel, type OpenRouterModel, aiModels, rateLimits } from "../lib/api";
import { aiModelCreateSchema, aiModelSelectSchema, zodErrorMessage } from "../lib/validation";

const models = ref<AIModel[]>([]);
const openRouterModels = ref<OpenRouterModel[]>([]);
const loading = ref(false);
const openRouterLoading = ref(false);
const error = ref("");
const openRouterError = ref("");
const showForm = ref(false);
const deletingId = ref<string | null>(null);
const formError = ref("");
const selectedModelId = ref("");
const selectedAllowedPlans = ref<string[]>([]);
const plans = ref<Array<{ value: string; label: string }>>([]);

const availableOpenRouterModels = computed(() => {
  const configuredIds = new Set(models.value.map((model) => model.id));
  return openRouterModels.value.filter((model) => !configuredIds.has(model.id));
});

const modelOptions = computed<ComboboxOption[]>(() =>
  availableOpenRouterModels.value.map((model) => ({
    value: model.id,
    label: model.name,
    badge: model.purpose,
    description: model.id,
    details: [
      { label: "Provider", value: model.provider },
      { label: "Context", value: model.maxTokens.toLocaleString() },
      { label: "Input", value: `${formatCost(model.costPer1kInput)}/1K` },
      { label: "Output", value: `${formatCost(model.costPer1kOutput)}/1K` },
    ],
  })),
);

const selectedOpenRouterModel = computed(
  () => availableOpenRouterModels.value.find((model) => model.id === selectedModelId.value) ?? null,
);

const saveDisabled = computed(() => openRouterLoading.value || selectedOpenRouterModel.value === null);
const planOptions = computed(() => plans.value);

function formatCost(value: number): string {
  return `$${value.toFixed(6)}`;
}

function formatPlans(values: string[]): string {
  if (values.length === 0) {
    return "-";
  }
  const labels = new Map(plans.value.map((plan) => [plan.value, plan.label]));
  return values.map((value) => labels.get(value) ?? value).join(", ");
}

async function loadModels(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    models.value = await aiModels.list();
  } catch {
    error.value = "Failed to load models";
  } finally {
    loading.value = false;
  }
}

async function loadOpenRouterModels(): Promise<void> {
  openRouterLoading.value = true;
  openRouterError.value = "";
  try {
    openRouterModels.value = await aiModels.listOpenRouter();
  } catch (err) {
    openRouterError.value = err instanceof Error ? err.message : "Failed to load OpenRouter models";
  } finally {
    openRouterLoading.value = false;
  }
}

async function loadPlans(): Promise<void> {
  try {
    const allPlans = await rateLimits.list();
    plans.value = allPlans.filter((plan) => plan.isActive).map((plan) => ({ value: plan.name, label: plan.label }));
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "Failed to load plans";
  }
}

function openAdd(): void {
  formError.value = "";
  openRouterError.value = "";
  selectedModelId.value = "";
  selectedAllowedPlans.value = plans.value.map((plan) => plan.value);
  showForm.value = true;
  void loadOpenRouterModels();
}

function closeForm(): void {
  showForm.value = false;
  formError.value = "";
  openRouterError.value = "";
}

function togglePlan(plan: string, selected: boolean): void {
  if (selected) {
    selectedAllowedPlans.value = Array.from(new Set([...selectedAllowedPlans.value, plan]));
  } else {
    selectedAllowedPlans.value = selectedAllowedPlans.value.filter((value) => value !== plan);
  }
}

async function save(): Promise<void> {
  formError.value = "";
  const selectedId = aiModelSelectSchema.safeParse({ id: selectedModelId.value });
  if (!selectedId.success) {
    formError.value = zodErrorMessage(selectedId.error);
    return;
  }

  const selectedModel = selectedOpenRouterModel.value;
  if (!selectedModel) {
    formError.value = "Choose an available OpenRouter model";
    return;
  }

  const parsedModel = aiModelCreateSchema.safeParse({
    ...selectedModel,
    isEnabled: true,
    allowedPlans: selectedAllowedPlans.value,
  });
  if (!parsedModel.success) {
    formError.value = zodErrorMessage(parsedModel.error);
    return;
  }

  try {
    await aiModels.create(parsedModel.data);
    closeForm();
    await loadModels();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "Failed to save";
  }
}

async function setDefault(id: string): Promise<void> {
  try {
    await aiModels.setDefault(id);
    await loadModels();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to set default";
  }
}

async function deleteModel(): Promise<void> {
  if (!deletingId.value) return;
  try {
    await aiModels.delete(deletingId.value);
    deletingId.value = null;
    await loadModels();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to delete";
  }
}

onMounted(() => {
  void loadModels();
  void loadPlans();
});
</script>

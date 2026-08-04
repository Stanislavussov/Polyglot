<template>
  <div>
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">AI Models</h1>
        <p class="mt-1 text-sm text-gray-500">Choose which model serves each plan, then manage the model catalog.</p>
      </div>
      <AppButton @click="openAdd">Add Model</AppButton>
    </div>

    <AlertMessage v-if="error" class="mt-6" type="error" :message="error" />
    <AlertMessage v-if="routingSaved" class="mt-6" type="success" message="Routing updated" />

    <!-- Routing: the single place that answers "which model is used when?" -->
    <section class="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h2 class="text-lg font-semibold text-gray-900">Model routing</h2>
      <p class="mt-1 text-sm text-gray-500">
        Every request is served by the model of the user's plan. A plan set to
        <em>Use default model</em> follows the default below.
      </p>

      <p v-if="loading" class="mt-4 text-sm text-gray-400">Loading...</p>
      <p v-else-if="enabledModels.length === 0" class="mt-4 text-sm text-gray-400">
        No enabled models yet — add one below first.
      </p>
      <div v-else class="mt-4 space-y-3">
        <div
          v-for="plan in plans"
          :key="plan.name"
          class="grid grid-cols-[160px_1fr] items-center gap-4 border-b border-gray-100 pb-3 last:border-0 last:pb-0"
        >
          <div>
            <p class="text-sm font-medium text-gray-900">{{ plan.label }}</p>
            <p class="text-xs text-gray-500">plan</p>
          </div>
          <select
            :id="`plan-model-${plan.name}`"
            class="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            :value="plan.aiModelId ?? ''"
            @change="setPlanModel(plan, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Use default model ({{ defaultModelLabel }})</option>
            <option v-for="model in enabledModels" :key="model.id" :value="model.id">{{ model.name }}</option>
          </select>
        </div>

        <div class="grid grid-cols-[160px_1fr] items-center gap-4 border-t border-gray-200 pt-4">
          <div>
            <p class="text-sm font-medium text-gray-900">Default model</p>
            <p class="text-xs text-gray-500">plans without their own choice, background jobs</p>
          </div>
          <select
            id="default-model"
            class="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            :value="defaultModelId"
            @change="setDefault(($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>Not set</option>
            <option v-for="model in enabledModels" :key="model.id" :value="model.id">{{ model.name }}</option>
          </select>
        </div>

        <div class="grid grid-cols-[160px_1fr] items-center gap-4">
          <div>
            <p class="text-sm font-medium text-gray-900">Fallback model</p>
            <p class="text-xs text-gray-500">retried when the model above fails</p>
          </div>
          <select
            id="fallback-model"
            class="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            :value="fallbackModelId"
            @change="setFallback(($event.target as HTMLSelectElement).value)"
          >
            <option value="">No fallback (single attempt)</option>
            <option v-for="model in enabledModels" :key="model.id" :value="model.id">{{ model.name }}</option>
          </select>
        </div>
      </div>
    </section>

    <div class="mt-8">
      <h2 class="text-lg font-semibold text-gray-900">Model catalog</h2>
      <p class="mt-1 text-sm text-gray-500">Models available for routing. Disabling a model removes it from routing.</p>
      <p v-if="loading" class="mt-4 text-sm text-gray-400">Loading...</p>
      <p v-else-if="models.length === 0" class="mt-4 text-sm text-gray-400">No models configured</p>
      <div v-else class="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table class="min-w-max divide-y divide-gray-200 sm:min-w-full">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Model</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Provider</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Max Tokens</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Cost In</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Cost Out</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Used for</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Status</th>
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
              <td class="px-4 py-3 text-sm">
                <div class="flex flex-wrap gap-1">
                  <span
                    v-for="role in rolesFor(model)"
                    :key="role.label"
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="role.class"
                  >
                    {{ role.label }}
                  </span>
                  <span v-if="rolesFor(model).length === 0" class="text-xs text-gray-400">not used</span>
                </div>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-sm">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="model.isEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-800'"
                >
                  {{ model.isEnabled ? "Enabled" : "Disabled" }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right text-sm space-x-2">
                <button class="font-medium text-indigo-600 hover:text-indigo-800" @click="toggleEnabled(model)">
                  {{ model.isEnabled ? "Disable" : "Enable" }}
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

        <dl v-if="selectedOpenRouterModel" class="grid grid-cols-1 gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm sm:grid-cols-2">
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
        <p class="text-sm text-gray-500">
          A new model is added to the catalog only. Assign it to a plan in Model routing above.
        </p>

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
import ComboboxField, { type ComboboxOption } from "./ui/ComboboxField.vue";
import { type AIModel, type OpenRouterModel, type PlanLimitConfig, aiModels, rateLimits } from "../lib/api";
import { aiModelCreateSchema, aiModelSelectSchema, zodErrorMessage } from "@polyglot/admin-contracts";

const models = ref<AIModel[]>([]);
const plans = ref<PlanLimitConfig[]>([]);
const openRouterModels = ref<OpenRouterModel[]>([]);
const loading = ref(false);
const openRouterLoading = ref(false);
const error = ref("");
const routingSaved = ref(false);
const openRouterError = ref("");
const showForm = ref(false);
const deletingId = ref<string | null>(null);
const formError = ref("");
const selectedModelId = ref("");

const enabledModels = computed(() => models.value.filter((model) => model.isEnabled));
const defaultModelId = computed(() => models.value.find((model) => model.isDefault)?.id ?? "");
const fallbackModelId = computed(() => models.value.find((model) => model.isFallback)?.id ?? "");
const defaultModelLabel = computed(
  () => models.value.find((model) => model.isDefault)?.name ?? "not set",
);

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

function formatCost(value: number): string {
  return `$${value.toFixed(6)}`;
}

/** Every role a model currently holds — this is what "which model is used when" looks like per row. */
function rolesFor(model: AIModel): Array<{ label: string; class: string }> {
  const roles: Array<{ label: string; class: string }> = [];
  if (model.isDefault) {
    roles.push({ label: "Default", class: "bg-emerald-100 text-emerald-800" });
  }
  if (model.isFallback) {
    roles.push({ label: "Fallback", class: "bg-amber-100 text-amber-800" });
  }
  for (const plan of plans.value) {
    if (plan.aiModelId === model.id) {
      roles.push({ label: plan.label, class: "bg-indigo-100 text-indigo-800" });
    }
  }
  return roles;
}

async function loadAll(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [modelList, planList] = await Promise.all([aiModels.list(), rateLimits.list()]);
    models.value = modelList;
    plans.value = planList.filter((plan) => plan.isActive);
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

function openAdd(): void {
  formError.value = "";
  openRouterError.value = "";
  selectedModelId.value = "";
  showForm.value = true;
  void loadOpenRouterModels();
}

function closeForm(): void {
  showForm.value = false;
  formError.value = "";
  openRouterError.value = "";
}

/** Shared post-write path: report the outcome and re-read, so the panel always shows persisted state. */
async function applyRoutingChange(change: () => Promise<unknown>, failureMessage: string): Promise<void> {
  error.value = "";
  routingSaved.value = false;
  try {
    await change();
    routingSaved.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : failureMessage;
  }
  await loadAll();
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

  const parsedModel = aiModelCreateSchema.safeParse({ ...selectedModel, isEnabled: true });
  if (!parsedModel.success) {
    formError.value = zodErrorMessage(parsedModel.error);
    return;
  }

  try {
    await aiModels.create(parsedModel.data);
    closeForm();
    await loadAll();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "Failed to save";
  }
}

function setPlanModel(plan: PlanLimitConfig, modelId: string): Promise<void> {
  return applyRoutingChange(
    () => rateLimits.update({ ...plan, aiModelId: modelId === "" ? null : modelId }),
    "Failed to update plan model",
  );
}

function setDefault(id: string): Promise<void> {
  return applyRoutingChange(() => aiModels.setDefault(id), "Failed to set default model");
}

function setFallback(id: string): Promise<void> {
  return applyRoutingChange(() => aiModels.setFallback(id === "" ? null : id), "Failed to set fallback model");
}

function toggleEnabled(model: AIModel): Promise<void> {
  return applyRoutingChange(
    () => aiModels.update(model.id, { isEnabled: !model.isEnabled }),
    "Failed to update model",
  );
}

async function deleteModel(): Promise<void> {
  if (!deletingId.value) return;
  const id = deletingId.value;
  deletingId.value = null;
  await applyRoutingChange(() => aiModels.delete(id), "Failed to delete");
}

onMounted(() => {
  void loadAll();
});
</script>

<template>
  <div class="space-y-5">
    <section class="grid gap-3 sm:grid-cols-3">
      <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-gray-500">Scenarios</span>
          <ClipboardCheck class="h-4 w-4 text-gray-400" />
        </div>
        <div class="mt-2 text-3xl font-semibold text-gray-900">{{ catalog?.summary.total ?? 0 }}</div>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-gray-500">Business</span>
          <BadgeCheck class="h-4 w-4 text-emerald-500" />
        </div>
        <div class="mt-2 text-3xl font-semibold text-gray-900">{{ catalog?.summary.business ?? 0 }}</div>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-gray-500">Technical</span>
          <Wrench class="h-4 w-4 text-slate-500" />
        </div>
        <div class="mt-2 text-3xl font-semibold text-gray-900">{{ catalog?.summary.technical ?? 0 }}</div>
      </div>
    </section>

    <section class="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div class="grid gap-3 border-b border-gray-200 p-4 lg:grid-cols-[1fr_180px_220px]">
        <label class="relative block">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            v-model="query"
            class="h-10 w-full rounded-md border border-gray-300 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            type="search"
            placeholder="Search scenarios"
          />
        </label>

        <select
          v-model="kindFilter"
          class="h-10 rounded-md border border-gray-300 px-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="all">All types</option>
          <option value="business">Business</option>
          <option value="technical">Technical</option>
        </select>

        <select
          v-model="packageFilter"
          class="h-10 rounded-md border border-gray-300 px-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="all">All packages</option>
          <option v-for="packageName in packageNames" :key="packageName" :value="packageName">
            {{ packageName }}
          </option>
        </select>
      </div>

      <div v-if="loading" class="p-8 text-sm text-gray-500">Loading test coverage...</div>
      <div v-else-if="error" class="p-8 text-sm text-red-600">{{ error }}</div>
      <div v-else class="grid min-h-[620px] lg:grid-cols-[minmax(0,1fr)_420px]">
        <div class="border-gray-200 lg:border-r">
          <div class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div class="text-sm font-medium text-gray-700">{{ filteredScenarios.length }} shown</div>
            <div class="text-xs text-gray-500">Generated {{ generatedLabel }}</div>
          </div>

          <div class="max-h-[720px] overflow-y-auto">
            <button
              v-for="scenario in filteredScenarios"
              :key="scenario.id"
              :class="[
                'block w-full border-b border-gray-100 px-4 py-3 text-left transition hover:bg-gray-50',
                selectedScenario?.id === scenario.id ? 'bg-indigo-50' : 'bg-white',
              ]"
              type="button"
              @click="selectedScenarioId = scenario.id"
            >
              <div class="flex min-w-0 items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold text-gray-900">{{ scenario.title }}</div>
                  <div class="mt-1 truncate text-xs text-gray-500">
                    {{ scenario.suitePath.join(" > ") || "Root" }}
                  </div>
                </div>
                <span
                  :class="[
                    'shrink-0 rounded px-2 py-1 text-xs font-semibold capitalize',
                    scenario.kind === 'business'
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
                  ]"
                >
                  {{ scenario.kind }}
                </span>
              </div>
              <p class="mt-2 line-clamp-2 text-sm leading-5 text-gray-600">{{ scenario.description }}</p>
              <div class="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                <span class="rounded bg-gray-100 px-2 py-1">{{ scenario.packageName }}</span>
                <span class="rounded bg-gray-100 px-2 py-1">{{ scenario.filePath }}:{{ scenario.sourceLine }}</span>
              </div>
            </button>

            <div v-if="filteredScenarios.length === 0" class="p-8 text-sm text-gray-500">No scenarios match.</div>
          </div>
        </div>

        <aside class="p-5">
          <div v-if="selectedScenario" class="sticky top-5 space-y-5">
            <div>
              <div class="mb-3 flex items-center gap-2">
                <span
                  :class="[
                    'rounded px-2 py-1 text-xs font-semibold capitalize',
                    selectedScenario.kind === 'business'
                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                      : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
                  ]"
                >
                  {{ selectedScenario.kind }}
                </span>
                <span class="text-xs text-gray-500">{{ selectedScenario.packageName }}</span>
              </div>
              <h2 class="text-lg font-semibold leading-7 text-gray-900">{{ selectedScenario.title }}</h2>
              <p class="mt-3 text-sm leading-6 text-gray-700">{{ selectedScenario.description }}</p>
            </div>

            <dl class="space-y-3 text-sm">
              <div>
                <dt class="font-medium text-gray-500">Suite</dt>
                <dd class="mt-1 text-gray-900">{{ selectedScenario.suitePath.join(" > ") || "Root" }}</dd>
              </div>
              <div>
                <dt class="font-medium text-gray-500">Source</dt>
                <dd class="mt-1 break-all font-mono text-xs text-gray-900">
                  {{ selectedScenario.filePath }}:{{ selectedScenario.sourceLine }}
                </dd>
              </div>
              <div>
                <dt class="font-medium text-gray-500">Workspace</dt>
                <dd class="mt-1 text-gray-900">{{ selectedScenario.workspace }}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { BadgeCheck, ClipboardCheck, Search, Wrench } from "lucide-vue-next";

type ScenarioKind = "business" | "technical";

type TestScenario = {
  id: string;
  kind: ScenarioKind;
  filePath: string;
  sourceLine: number;
  workspace: string;
  packageName: string;
  suitePath: string[];
  title: string;
  description: string;
};

type TestCatalog = {
  generatedAt: string;
  summary: {
    total: number;
    business: number;
    technical: number;
    workspaces: string[];
    packages: string[];
  };
  scenarios: TestScenario[];
};

const catalog = ref<TestCatalog | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const query = ref("");
const kindFilter = ref<ScenarioKind | "all">("all");
const packageFilter = ref("all");
const selectedScenarioId = ref<string | null>(null);

const packageNames = computed(() => catalog.value?.summary.packages ?? []);

const filteredScenarios = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase();

  return (catalog.value?.scenarios ?? []).filter((scenario) => {
    const matchesKind = kindFilter.value === "all" || scenario.kind === kindFilter.value;
    const matchesPackage = packageFilter.value === "all" || scenario.packageName === packageFilter.value;
    const searchable = [
      scenario.title,
      scenario.description,
      scenario.filePath,
      scenario.packageName,
      scenario.suitePath.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    const matchesQuery = normalizedQuery.length === 0 || searchable.includes(normalizedQuery);

    return matchesKind && matchesPackage && matchesQuery;
  });
});

const selectedScenario = computed(() => {
  const scenarios = filteredScenarios.value;
  return scenarios.find((scenario) => scenario.id === selectedScenarioId.value) ?? scenarios[0] ?? null;
});

const generatedLabel = computed(() => {
  if (!catalog.value) {
    return "unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(catalog.value.generatedAt));
});

watch(filteredScenarios, (scenarios) => {
  if (!scenarios.some((scenario) => scenario.id === selectedScenarioId.value)) {
    selectedScenarioId.value = scenarios[0]?.id ?? null;
  }
});

onMounted(async () => {
  try {
    const response = await fetch("/reports/test-catalog.json");
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    const nextCatalog = (await response.json()) as TestCatalog;
    catalog.value = nextCatalog;
    selectedScenarioId.value = nextCatalog.scenarios[0]?.id ?? null;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Failed to load test catalog";
  } finally {
    loading.value = false;
  }
});
</script>

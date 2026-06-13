<template>
  <section class="mt-8 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex min-w-0 items-start gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" :class="statusTone.icon">
          <component :is="statusTone.iconComponent" class="h-5 w-5" aria-hidden="true" />
        </div>
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-gray-900">OpenRouter API key</h2>
          <p class="mt-1 text-sm text-gray-500">{{ statusMessage }}</p>
          <p v-if="keyInfo?.label" class="mt-2 truncate text-sm text-gray-700">
            <span class="font-medium">Key:</span> {{ keyInfo.label }}
          </p>
        </div>
      </div>

      <button
        type="button"
        class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="loading"
        @click="loadKeyInfo"
      >
        <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" aria-hidden="true" />
        Refresh
      </button>
    </div>

    <dl class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div class="rounded-md bg-gray-50 px-3 py-3">
        <dt class="text-xs font-medium uppercase text-gray-500">Status</dt>
        <dd class="mt-1 text-sm font-semibold" :class="statusTone.text">{{ statusLabel }}</dd>
      </div>
      <div class="rounded-md bg-gray-50 px-3 py-3">
        <dt class="text-xs font-medium uppercase text-gray-500">Expires</dt>
        <dd class="mt-1 text-sm font-semibold text-gray-900">{{ formattedExpiration }}</dd>
      </div>
      <div class="rounded-md bg-gray-50 px-3 py-3">
        <dt class="text-xs font-medium uppercase text-gray-500">Remaining</dt>
        <dd class="mt-1 text-sm font-semibold text-gray-900">{{ remainingLabel }}</dd>
      </div>
    </dl>

    <p v-if="error" class="mt-4 text-sm text-red-600">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { AlertTriangle, CalendarClock, CheckCircle2, KeyRound, RefreshCw } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { type OpenRouterKeyInfo, type OpenRouterKeyStatus, openRouter } from "../lib/api";

const keyInfo = ref<OpenRouterKeyInfo | null>(null);
const loading = ref(false);
const error = ref("");

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const statusCopy: Record<OpenRouterKeyStatus, { label: string; message: string }> = {
  active: {
    label: "Active",
    message: "The configured OpenRouter key has an expiration timestamp and is currently valid.",
  },
  expiring_soon: {
    label: "Expiring soon",
    message: "The configured OpenRouter key expires within 30 days.",
  },
  expired: {
    label: "Expired",
    message: "The configured OpenRouter key has passed its expiration timestamp.",
  },
  unknown: {
    label: "No expiration reported",
    message: "OpenRouter did not return an expiration timestamp for this key.",
  },
  not_configured: {
    label: "Not configured",
    message: "OPENROUTER_API_KEY is not configured for the admin API.",
  },
};

const status = computed<OpenRouterKeyStatus>(() => keyInfo.value?.status ?? "unknown");
const statusLabel = computed(() => statusCopy[status.value].label);
const statusMessage = computed(() => {
  if (error.value) {
    return "Unable to load the OpenRouter key status.";
  }
  if (loading.value && keyInfo.value === null) {
    return "Loading OpenRouter key status...";
  }
  return statusCopy[status.value].message;
});

const statusTone = computed(() => {
  if (status.value === "active") {
    return { icon: "bg-emerald-50 text-emerald-600", text: "text-emerald-700", iconComponent: CheckCircle2 };
  }
  if (status.value === "expiring_soon") {
    return { icon: "bg-amber-50 text-amber-600", text: "text-amber-700", iconComponent: CalendarClock };
  }
  if (status.value === "expired") {
    return { icon: "bg-red-50 text-red-600", text: "text-red-700", iconComponent: AlertTriangle };
  }
  return { icon: "bg-gray-100 text-gray-600", text: "text-gray-700", iconComponent: KeyRound };
});

const formattedExpiration = computed(() => {
  if (!keyInfo.value?.expiresAt) {
    return "Not reported";
  }
  return dateFormatter.format(new Date(keyInfo.value.expiresAt));
});

const remainingLabel = computed(() => {
  const daysRemaining = keyInfo.value?.daysRemaining;
  if (daysRemaining === null || daysRemaining === undefined) {
    return "Unknown";
  }
  if (daysRemaining <= 0) {
    return "Expired";
  }
  return `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"}`;
});

async function loadKeyInfo(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    keyInfo.value = await openRouter.key();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load OpenRouter key status";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadKeyInfo();
});
</script>

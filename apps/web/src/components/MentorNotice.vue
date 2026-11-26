<template>
  <p v-if="lockedHint" role="alert" class="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">
    {{ t("web.explore.lockedHint") }}
  </p>
  <LimitNotice v-else-if="limit" :reason="limit.reason" :reset-at="limit.resetAt" />
  <p v-else-if="errorText" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ errorText }}</p>
</template>

<script setup lang="ts">
import { t } from "../lib/i18n";
import LimitNotice from "./LimitNotice.vue";

defineProps<{
  lockedHint: boolean;
  limit: { reason?: "plan" | "daily_ceiling"; resetAt?: string } | null;
  errorText: string | null;
}>();
</script>

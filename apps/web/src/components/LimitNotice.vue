<template>
  <div role="alert" class="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">
    {{ message }}
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatReset } from "../lib/format";
import { lang, t } from "../lib/i18n";

const props = defineProps<{
  reason?: "plan" | "daily_ceiling";
  resetAt?: string;
}>();

const message = computed(() =>
  t(props.reason === "daily_ceiling" ? "web.limit.daily" : "web.limit.plan", {
    time: formatReset(props.resetAt, lang.value),
  }),
);
</script>

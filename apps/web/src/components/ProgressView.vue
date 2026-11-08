<template>
  <section>
    <p v-if="failed" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>
    <p v-else-if="!data" class="text-sm text-ink-muted" role="status">{{ t("web.common.loading") }}</p>
    <p v-else-if="!data.enabled" class="card text-center text-ink-muted">{{ t("web.progress.off") }}</p>
    <template v-else>
      <h1 class="text-2xl font-bold tracking-tight">{{ data.title }}</h1>
      <p v-if="data.recovery" role="status" class="mt-4 rounded-xl bg-primary-soft px-4 py-3 text-sm text-primary-soft-fg">{{ data.recovery }}</p>
      <article class="card mt-6 space-y-4">
        <p class="text-lg font-semibold">{{ data.phrase }}</p>
        <div v-if="data.stats.length > 0" class="flex gap-1" role="img" :aria-label="`${data.level}/5`">
          <span v-for="cell in 5" :key="cell" :class="['h-2 flex-1 rounded-full', cell <= data.level ? 'bg-primary' : 'bg-surface-muted']" />
        </div>
        <ul v-if="data.stats.length > 0" class="space-y-1 text-sm">
          <li v-for="line in data.stats" :key="line">{{ line }}</li>
        </ul>
        <a v-if="data.stats.length > 0" href="/review/" class="btn-primary w-full sm:w-auto">{{ data.reviewLabel }}</a>
      </article>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import type { Progress } from "../lib/types";

const data = ref<Progress | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    data.value = await api.progress();
  } catch {
    failed.value = true;
  }
});
</script>

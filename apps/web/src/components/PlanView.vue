<template>
  <section>
    <h1 class="text-2xl font-bold tracking-tight">{{ t("web.plan.title") }}</h1>

    <template v-if="info">
      <div class="card mt-6">
        <p class="text-lg font-semibold">{{ t("web.plan.current", { plan: info.current.label }) }}</p>
        <p v-if="info.current.periodEnd" class="mt-1 text-sm text-ink-muted">
          {{ t(info.current.trial ? "web.plan.trial" : "web.plan.activeUntil", { date: formatDate(info.current.periodEnd) }) }}
        </p>
        <ul class="mt-3 space-y-1 text-sm">
          <li v-for="line in lines(info.current.translationLimit, false, info.current.features)" :key="line">✓ {{ line }}</li>
        </ul>
      </div>

      <div v-if="info.plans.length > 0" class="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <article
          v-for="plan in info.plans"
          :key="plan.name"
          class="card"
          :class="{ 'border-primary': plan.name === info.current.name }"
        >
          <h2 class="text-lg font-semibold">{{ plan.label }}</h2>
          <p class="text-sm text-ink-muted">{{ t("web.plan.perMonth", { price: formatPrice(plan.priceUsdCents) }) }}</p>
          <ul class="mt-3 space-y-1 text-sm">
            <li v-for="line in lines(plan.translationLimit, plan.video, plan.features)" :key="line">✓ {{ line }}</li>
          </ul>
        </article>
      </div>
      <p v-else class="mt-6 text-sm text-ink-muted">{{ t("web.plan.comingSoon") }}</p>

      <div v-if="info.plans.length > 0" class="mt-6 flex flex-wrap items-center gap-3">
        <a class="btn-primary" :href="info.upgradeUrl" target="_blank" rel="noopener">{{ t("web.plan.upgrade") }}</a>
        <span class="text-sm text-ink-muted">{{ t("web.plan.upgradeHint") }}</span>
      </div>
    </template>
    <p v-else-if="failed" class="mt-6 text-sm text-ink-muted" role="alert">{{ t("web.common.error") }}</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import type { PlanInfo } from "../lib/types";

// The features the bot's plan screen names; retired keys still listed by old plan rows stay unnamed.
const NAMED_FEATURES = ["clarification", "pronunciation", "voiceInput", "mentor", "etymology"];

const info = ref<PlanInfo | null>(null);
const failed = ref(false);

function lines(translationLimit: number | null, video: boolean, features: string[]): string[] {
  return [
    translationLimit === null ? t("web.plan.translationsUnlimited") : t("web.plan.translations", { count: translationLimit }),
    ...(video ? [t("web.plan.video")] : []),
    ...NAMED_FEATURES.filter((key) => features.includes(key)).map((key) => t(`web.plan.feature.${key}`)),
  ];
}

// The bot's price format: $5, $10.50.
function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(lang.value, { day: "numeric", month: "long", year: "numeric" });
}

onMounted(async () => {
  try {
    info.value = await api.plan();
  } catch {
    failed.value = true;
  }
});
</script>

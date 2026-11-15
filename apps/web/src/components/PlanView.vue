<template>
  <section>
    <header>
      <h1 class="page-title">{{ t("web.plan.title") }}</h1>
      <p class="mt-3 text-base text-ink-muted">
        <template v-if="info">
          {{ t("web.plan.currentLine", { plan: info.current.label }) }}<template v-if="info.current.periodEnd">
            · {{ t(info.current.trial ? "web.plan.trial" : "web.plan.activeUntil", { date: formatDate(info.current.periodEnd) }) }}
          </template>
        </template>
        <template v-else>{{ t("web.plan.subtitle") }}</template>
      </p>
    </header>

    <p
      v-if="notice"
      role="status"
      :class="[
        'mt-6 flex items-center gap-3 rounded-2xl px-4 py-3 text-base',
        notice.tone === 'ok' ? 'bg-primary-soft text-primary-soft-fg' : 'bg-danger-soft text-danger',
      ]"
    >
      <CircleCheck v-if="notice.tone === 'ok'" class="size-5 shrink-0" aria-hidden="true" />
      <CircleAlert v-else class="size-5 shrink-0" aria-hidden="true" />
      {{ notice.text }}
    </p>

    <p v-if="failed" role="alert" class="mt-6 rounded-2xl bg-danger-soft px-4 py-3 text-base text-danger">{{ t("web.common.error") }}</p>

    <!-- Placeholders keep the grid's height while loading, so nothing jumps when the plans arrive. -->
    <div v-else class="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <template v-if="info">
        <article
          v-for="plan in info.plans"
          :key="plan.name"
          :class="[
            'relative flex flex-col rounded-3xl border bg-surface p-6 shadow-card',
            plan.current ? 'border-primary ring-2 ring-primary' : 'border-line',
          ]"
        >
          <div class="flex min-h-8 items-center justify-between gap-3">
            <h2 class="text-2xl font-bold">{{ plan.label }}</h2>
            <span v-if="plan.current" class="rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-fg">
              {{ t("web.plan.yourPlan") }}
            </span>
          </div>
          <p class="mt-1 min-h-6 text-sm text-ink-muted">{{ tagline(plan.name) }}</p>

          <p class="mt-6 flex items-baseline gap-2">
            <span class="text-3xl font-extrabold">{{ priceText(plan.priceUsdCents) }}</span>
            <span v-if="plan.priceUsdCents" class="text-sm text-ink-muted">{{ t("web.plan.monthShort") }}</span>
          </p>

          <div class="mt-6">
            <button v-if="plan.current" type="button" class="btn-secondary w-full" disabled>
              {{ t("web.plan.currentButton") }}
            </button>
            <button
              v-else-if="plan.buyable && info.checkout"
              type="button"
              class="btn-primary w-full"
              :disabled="buying !== null"
              @click="buy(plan.name)"
            >
              {{ t("web.plan.buy", { plan: plan.label }) }}
            </button>
            <a v-else-if="plan.buyable" class="btn-primary w-full" :href="info.upgradeUrl" target="_blank" rel="noopener">
              {{ t("web.plan.upgrade") }}
            </a>
            <p v-else class="flex min-h-11 items-center justify-center text-sm text-ink-muted">
              {{ t("web.plan.includedInYours") }}
            </p>
          </div>

          <div class="mt-6 border-t border-line pt-6">
            <h3 class="text-sm font-semibold text-ink-muted">{{ t("web.plan.whatsIncluded") }}</h3>
            <ul class="mt-3 space-y-3">
              <li v-for="line in lines(plan)" :key="line" class="flex items-start gap-3 text-base">
                <Check class="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                <span>{{ line }}</span>
              </li>
            </ul>
          </div>
        </article>
      </template>
      <template v-else>
        <div v-for="slot in 3" :key="slot" class="h-96 animate-pulse rounded-3xl border border-line bg-surface-muted" />
      </template>
    </div>

    <p v-if="info" class="mt-6 flex items-center gap-2 text-sm text-ink-muted">
      <LockKeyhole class="size-4 shrink-0" aria-hidden="true" />
      {{ info.checkout ? t("web.plan.buyHint") : t("web.plan.upgradeHint") }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { Check, CircleAlert, CircleCheck, LockKeyhole } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import type { PlanInfo, PlanOffer, SettleOutcome } from "../lib/types";

// The features the bot's plan screen names; retired keys still listed by old plan rows stay unnamed.
const NAMED_FEATURES = ["clarification", "pronunciation", "voiceInput", "mentor", "etymology"];
const TAGLINES = new Set(["free", "plus", "pro"]);

const info = ref<PlanInfo | null>(null);
const failed = ref(false);
const notice = ref<{ text: string; tone: "ok" | "bad" } | null>(null);
const buying = ref<string | null>(null);

const OUTCOME_NOTICE: Record<SettleOutcome, { key: string; tone: "ok" | "bad" }> = {
  granted: { key: "web.plan.paid", tone: "ok" },
  already: { key: "web.plan.paid", tone: "ok" },
  pending: { key: "web.plan.paymentPending", tone: "ok" },
  failed: { key: "web.plan.paymentFailed", tone: "bad" },
  unknown: { key: "web.plan.paymentFailed", tone: "bad" },
};

function lines(plan: PlanOffer): string[] {
  return [
    plan.translationLimit === null
      ? t("web.plan.translationsUnlimited")
      : t("web.plan.translations", { count: plan.translationLimit }),
    ...(plan.video ? [t("web.plan.video")] : []),
    ...NAMED_FEATURES.filter((key) => plan.features.includes(key)).map((key) => t(`web.plan.feature.${key}`)),
  ];
}

function tagline(name: string): string {
  return TAGLINES.has(name) ? t(`web.plan.tagline.${name}`) : "";
}

// The bot's price format: $5, $10.50.
function priceText(cents: number | null): string {
  if (cents === null) return "—";
  if (cents === 0) return t("web.plan.free");
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(lang.value, { day: "numeric", month: "long", year: "numeric" });
}

async function buy(plan: string): Promise<void> {
  buying.value = plan;
  try {
    const { url } = await api.checkout(plan);
    window.location.assign(url);
  } catch {
    buying.value = null;
    notice.value = { text: t("web.plan.checkoutFailed"), tone: "bad" };
  }
}

// Back from the payment page: `?charge=<id>`. Settle before loading, so the card
// already shows the new plan; then drop the id so a reload does not repeat it.
async function settleReturn(): Promise<void> {
  const chargeId = new URLSearchParams(window.location.search).get("charge");
  if (!chargeId) return;
  window.history.replaceState(null, "", window.location.pathname);
  try {
    const { outcome } = await api.settlePayment(chargeId);
    const { key, tone } = OUTCOME_NOTICE[outcome];
    notice.value = { text: t(key), tone };
  } catch {
    notice.value = { text: t("web.plan.paymentPending"), tone: "ok" };
  }
}

onMounted(async () => {
  await settleReturn();
  try {
    info.value = await api.plan();
  } catch {
    failed.value = true;
  }
});
</script>

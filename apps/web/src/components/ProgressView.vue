<template>
  <section>
    <p v-if="failed" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>
    <p v-else-if="!data" class="text-sm text-ink-muted" role="status">{{ t("web.common.loading") }}</p>
    <p v-else-if="!data.enabled" class="card text-center text-ink-muted">{{ t("web.progress.off") }}</p>
    <template v-else>
      <header>
        <h1 class="page-title">{{ t("web.progress.title") }}</h1>
        <p class="mt-3 text-base text-ink-muted">{{ data.phrase }}</p>
      </header>

      <p v-if="data.recovery" role="status" class="mt-4 rounded-xl bg-primary-soft px-4 py-3 text-sm text-primary-soft-fg">{{ data.recovery }}</p>
      <p
        v-for="gift in data.ladder?.rewards ?? []"
        :key="gift"
        role="status"
        class="mt-4 flex items-center gap-3 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-fg"
      >
        <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1.5S9 8 12 8Zm0 0c2-4 6-4 6-1.5S15 8 12 8Z" />
        </svg>
        {{ gift }}
      </p>

      <!-- Rhythm: where the learner stands on the four momentum steps. -->
      <article class="card mt-6">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.progress.rhythm") }}</h2>
          <span class="text-xl font-bold text-primary">{{ t(`web.progress.band.${m.band}`) }}</span>
        </div>
        <ol class="mt-4 grid grid-cols-4 gap-2">
          <li v-for="(band, index) in BANDS" :key="band" class="min-w-0">
            <span :class="['block h-2.5 rounded-full transition-colors', index <= bandIndex ? 'bg-primary' : 'bg-surface-muted']" />
            <span :class="['mt-2 block truncate text-sm', index === bandIndex ? 'font-semibold text-ink' : 'text-ink-muted']">
              {{ t(`web.progress.band.${band}`) }}
            </span>
          </li>
        </ol>
      </article>

      <!-- The page's main answer: what is going well and what to do next. -->
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <article class="card">
          <h2 class="flex items-center gap-2 text-base font-semibold">
            <span class="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />{{ t("web.progress.good") }}
          </h2>
          <ul v-if="insights.good.length > 0" class="mt-3 space-y-2.5">
            <li v-for="item in insights.good" :key="item.key" class="flex gap-3 text-base">
              <svg class="mt-0.5 h-5 w-5 shrink-0 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              {{ t(`web.progress.insight.${item.key}`, item.params) }}
            </li>
          </ul>
          <p v-else class="mt-3 text-base text-ink-muted">{{ data.phrase }}</p>
        </article>
        <article class="card">
          <h2 class="flex items-center gap-2 text-base font-semibold">
            <span class="h-2.5 w-2.5 rounded-full bg-warning-fg" aria-hidden="true" />{{ t("web.progress.improve") }}
          </h2>
          <ul v-if="insights.improve.length > 0" class="mt-3 space-y-2">
            <li v-for="item in insights.improve" :key="item.key">
              <a
                v-if="ACTION[item.key]"
                :href="ACTION[item.key]"
                class="flex items-center gap-3 rounded-lg bg-warning-soft px-3 py-2 text-base text-warning-fg hover:brightness-95"
              >
                <span class="flex-1">{{ t(`web.progress.insight.${item.key}`, item.params) }}</span>
                <span aria-hidden="true">→</span>
              </a>
              <p v-else class="rounded-lg bg-warning-soft px-3 py-2 text-base text-warning-fg">{{ t(`web.progress.insight.${item.key}`, item.params) }}</p>
            </li>
          </ul>
          <p v-else class="mt-3 text-base text-ink-muted">{{ t("web.progress.allGood") }}</p>
        </article>
      </div>

      <div v-if="m.words > 0" :class="['mt-4 grid gap-4', ladder && 'lg:grid-cols-[1fr_1.4fr]']">
        <!-- Today: one ring, one number, one button. -->
        <article class="card flex flex-wrap items-center gap-5">
          <div class="relative h-24 w-24 shrink-0">
            <svg class="h-full w-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke-width="3.5" class="stroke-surface-muted" />
              <circle
                cx="18" cy="18" r="15.5" fill="none" stroke-width="3.5" stroke-linecap="round" class="stroke-primary transition-all"
                :stroke-dasharray="`${todayShare * RING} ${RING}`"
              />
            </svg>
            <span class="absolute inset-0 flex items-center justify-center text-xl font-bold">{{ Math.round(todayShare * 100) }}%</span>
          </div>
          <div class="min-w-[13rem] flex-1 space-y-2">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.progress.today") }}</h2>
            <p class="text-base font-semibold">
              {{ ladder?.day.done ? t("web.progress.todayDone") : ladder ? t("web.progress.todayOf", ladder.day) : t("web.progress.dueCount", { count: m.due }) }}
            </p>
            <a href="/review/" class="btn-primary max-w-full whitespace-normal text-center [overflow-wrap:normal]">{{ m.due > 0 ? t("web.progress.dueCount", { count: m.due }) : data.reviewLabel }}</a>
          </div>
        </article>

        <!-- Path to the gift: counted months as stations, the gift at the end. -->
        <article v-if="ladder" class="card">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.progress.path") }}</h2>
            <span class="text-sm text-ink-muted">{{ t("web.progress.pathMonths", { count: ladder.cycleMonths, total: ladder.monthsForReward }) }}</span>
          </div>
          <ol class="mt-4 flex items-center">
            <template v-for="station in ladder.monthsForReward" :key="station">
              <li
                :class="[
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                  station <= ladder.cycleMonths ? 'bg-primary text-primary-fg' : station === ladder.cycleMonths + 1 ? 'border-2 border-primary text-primary' : 'bg-surface-muted text-ink-muted',
                ]"
              >{{ station }}</li>
              <span :class="['h-1 min-w-2 flex-1', station <= ladder.cycleMonths ? 'bg-primary' : 'bg-surface-muted']" aria-hidden="true" />
            </template>
            <li class="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1.5S9 8 12 8Zm0 0c2-4 6-4 6-1.5S15 8 12 8Z" />
              </svg>
              {{ t("web.progress.pathGift", { days: ladder.rewardDays }) }}
            </li>
          </ol>

          <h3 class="mt-5 text-sm font-semibold">{{ ladder.month.counted ? t("web.progress.monthCounted") : t("web.progress.thisMonth") }}</h3>
          <dl class="mt-2 space-y-3">
            <div v-for="bar in monthBars" :key="bar.label">
              <div class="flex justify-between text-sm">
                <dt class="text-ink-muted">{{ bar.label }}</dt>
                <dd class="font-semibold">{{ bar.value }} / {{ bar.target }}</dd>
              </div>
              <div class="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                <div :class="['h-full rounded-full transition-all', bar.ok ? 'bg-primary' : 'bg-warning-fg']" :style="{ width: `${bar.share * 100}%` }" />
              </div>
            </div>
          </dl>
          <button v-if="bar.snoozed.value" type="button" class="mt-4 text-sm text-ink-muted underline hover:text-ink" @click="bar.show()">
            {{ t("web.progress.barShow") }}
          </button>
        </article>
      </div>

      <dl v-if="m.words > 0" class="mt-4 grid grid-cols-2 gap-3 md:auto-cols-fr md:grid-flow-col md:grid-cols-none max-md:[&>*:last-child:nth-child(odd)]:col-span-2">
        <div v-for="stat in stats" :key="stat.label" class="card">
          <dd class="text-2xl font-bold tracking-tight">{{ stat.value }}</dd>
          <dt class="mt-1 text-sm text-ink-muted">{{ stat.label }}</dt>
        </div>
      </dl>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { type InsightKey, monthPace, progressInsights } from "../lib/progress-insights";
import type { MomentumBand, Progress, ProgressMetrics } from "../lib/types";
import { useProgressBar } from "../lib/use-progress-bar";

const BANDS: MomentumBand[] = ["resting", "warming", "steady", "strong"];
const RING = 2 * Math.PI * 15.5;
const ACTION: Partial<Record<InsightKey, string>> = {
  reviewDue: "/review/",
  todayTodo: "/review/",
  weekTodo: "/review/",
  monthBehind: "/review/",
  newWords: "/translate/",
  firstWord: "/translate/",
};
const EMPTY: ProgressMetrics = { band: "resting", words: 0, mature: 0, due: 0, activeDays: 0 };

const bar = useProgressBar();
const data = ref<Progress | null>(null);
const failed = ref(false);

const m = computed(() => (data.value?.enabled ? data.value.metrics : EMPTY));
const ladder = computed(() => m.value.ladder);
const bandIndex = computed(() => BANDS.indexOf(m.value.band));
const insights = computed(() => progressInsights(m.value, new Date()));
const todayShare = computed(() => {
  const day = ladder.value?.day;
  if (day) return Math.min(day.reviews / Math.max(day.target, 1), 1);
  return m.value.due === 0 ? 1 : 0;
});

const monthBars = computed(() => {
  const month = ladder.value?.month;
  if (!month) return [];
  const share = (value: number, target: number) => Math.min(value / Math.max(target, 1), 1);
  return [
    {
      label: t("web.progress.monthDays"),
      value: month.activeDays,
      target: month.minActiveDays,
      share: share(month.activeDays, month.minActiveDays),
      ok: month.counted || monthPace(month, new Date()).onPace,
    },
    {
      label: t("web.progress.monthWords"),
      value: month.saved,
      target: month.minNewWords,
      share: month.mature > 0 ? 1 : share(month.saved, month.minNewWords),
      ok: month.counted || month.mature > 0 || month.saved >= month.minNewWords,
    },
  ];
});

const stats = computed(() => {
  const milestone = ladder.value?.milestone;
  const base = [
    { label: t("web.progress.stat.words"), value: m.value.words },
    { label: t("web.progress.stat.mature"), value: m.value.mature },
    { label: t("web.progress.stat.active"), value: `${m.value.activeDays}/28` },
  ];
  if (!ladder.value) return base;
  if (!milestone) return [...base, { label: t("web.progress.stat.milestoneAll"), value: "✓" }];
  return [
    ...base,
    { label: t("web.progress.stat.milestone", { target: milestone.target }), value: `${milestone.target - milestone.remaining}/${milestone.target}` },
  ];
});

onMounted(async () => {
  try {
    data.value = await api.progress();
  } catch {
    failed.value = true;
  }
});
</script>

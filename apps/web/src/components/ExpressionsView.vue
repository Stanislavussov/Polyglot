<template>
  <section class="space-y-4">
    <a href="/learn/" class="text-sm text-ink-muted hover:underline">{{ t("web.learn.back") }}</a>
    <h1 class="text-2xl font-bold tracking-tight">💬 {{ t("web.learn.expressions") }}</h1>

    <p v-if="busy" class="text-sm text-ink-muted" role="status">{{ t("web.learn.expr.generating") }}</p>
    <LimitNotice v-else-if="limit" :reason="limit.reason" :reset-at="limit.resetAt" />
    <p v-else-if="failed" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.learn.expr.failed") }}</p>

    <article v-if="expression && !busy" class="card space-y-3" aria-live="polite">
      <h2 class="text-2xl font-bold">🎭 {{ expression.expression }}</h2>
      <p v-if="expression.translation" class="italic">{{ expression.translation }}</p>
      <p>💡 {{ expression.meaning }}</p>
      <p v-if="source" class="text-sm text-ink-muted">{{ source }}</p>
      <p class="border-l-2 border-line pl-3 text-sm font-medium">{{ expression.example }}</p>
      <div class="flex flex-wrap gap-2 pt-2">
        <!-- The bot's save button translates the expression and lands on its card, which carries the save. -->
        <a class="btn-secondary" :href="`/translate/?q=${encodeURIComponent(expression.expression)}`">{{ t("web.learn.expr.save") }}</a>
        <button type="button" class="btn-primary" @click="next">{{ t("web.learn.expr.more") }}</button>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { type Expression, learnApi } from "../lib/learn-api";
import LimitNotice from "./LimitNotice.vue";

const SOURCE_ICONS: Record<string, string> = {
  film: "🎬",
  series: "📺",
  book: "📖",
  person: "👤",
  song: "🎵",
  folk: "🗣",
  history: "🏛",
  sport: "⚽",
  other: "💡",
};

const expression = ref<Expression | null>(null);
const busy = ref(false);
const failed = ref(false);
const limit = ref<{ reason?: "plan" | "daily_ceiling"; resetAt?: string } | null>(null);

const source = computed(() => {
  const shown = expression.value;
  if (!shown) return null;
  const icon = SOURCE_ICONS[shown.sourceKind] ?? SOURCE_ICONS.other;
  const title = shown.sourceTitle?.trim();
  if (title) return `${icon} ${title}`;
  return shown.sourceKind === "folk" ? `${icon} ${t("web.learn.expr.folk")}` : null;
});

async function next(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  failed.value = false;
  limit.value = null;
  const avoid = expression.value ? [expression.value.expression] : [];
  try {
    expression.value = (await learnApi.expression(avoid)).expression;
  } catch (err) {
    if (err instanceof ApiError && err.code === "limit")
      limit.value = { reason: err.body.reason as "plan" | "daily_ceiling", resetAt: err.body.resetAt };
    else failed.value = true;
  } finally {
    busy.value = false;
  }
}

onMounted(next);
</script>

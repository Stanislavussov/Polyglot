<template>
  <section class="space-y-4">
    <a href="/learn/" class="text-sm text-ink-muted hover:underline">{{ t("web.learn.back") }}</a>
    <h1 class="text-2xl font-bold tracking-tight">✍️ {{ t("web.learn.grammar") }}</h1>
    <p class="text-sm text-ink-muted">{{ t("web.learn.grammar.intro") }}</p>

    <form class="space-y-2" @submit.prevent="check">
      <label class="sr-only" for="grammar-text">{{ t("web.learn.grammar.placeholder") }}</label>
      <textarea
        id="grammar-text"
        v-model="text"
        class="field min-h-24 resize-y"
        rows="3"
        :maxlength="MAX_TEXT"
        :placeholder="t('web.learn.grammar.placeholder')"
      />
      <button type="submit" class="btn-primary" :disabled="busy || text.trim() === ''">
        {{ busy ? t("web.explore.thinking") : t("web.learn.grammar") }}
      </button>
    </form>

    <LimitNotice v-if="limit" :reason="limit.reason" :reset-at="limit.resetAt" />
    <p v-else-if="errorText" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ errorText }}</p>

    <article v-if="result" class="card space-y-4" aria-live="polite">
      <template v-if="result.status === 'unsupported_language'">
        <p>{{ t("web.learn.grammar.unsupported", { languages: result.languages.join(", ") }) }}</p>
      </template>
      <template v-else-if="result.errors.length === 0">
        <p class="font-semibold">{{ t("web.learn.grammar.correct") }}</p>
        <template v-if="result.naturalAlternative">
          <p class="text-sm">{{ t("web.learn.grammar.natural") }}</p>
          <p class="italic">{{ result.naturalAlternative }}</p>
        </template>
      </template>
      <template v-else>
        <h2 class="font-semibold">{{ t("web.learn.grammar.issues") }}</h2>
        <ol class="space-y-3">
          <li v-for="(issue, index) in result.errors" :key="index" class="space-y-1 rounded-xl bg-surface-muted px-4 py-3 text-sm">
            <p>
              {{ index + 1 }}. <s>{{ issue.fragment }}</s> → <b>{{ issue.correction }}</b>
            </p>
            <p>🏷 {{ issue.categoryLabel }}</p>
            <p>{{ t("web.learn.grammar.why") }} {{ issue.explanation }}</p>
            <p>{{ t("web.learn.grammar.example") }} <i>{{ issue.example }}</i></p>
          </li>
        </ol>
        <p class="border-t border-line pt-3 text-sm">
          <span class="font-semibold">{{ t("web.learn.grammar.corrected") }}</span> {{ result.correctedText }}
        </p>
      </template>
    </article>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { type GrammarResult, learnApi } from "../lib/learn-api";
import LimitNotice from "./LimitNotice.vue";

const MAX_TEXT = 1000;

const text = ref("");
const busy = ref(false);
const result = ref<GrammarResult | null>(null);
const limit = ref<{ reason?: "plan" | "daily_ceiling"; resetAt?: string } | null>(null);
const errorText = ref<string | null>(null);

async function check(): Promise<void> {
  if (busy.value || text.value.trim() === "") return;
  busy.value = true;
  limit.value = null;
  errorText.value = null;
  try {
    result.value = await learnApi.grammarCheck(text.value.trim());
  } catch (err) {
    result.value = null;
    if (err instanceof ApiError && err.code === "grammar_limit") {
      const max = err.body.limit ?? 0;
      errorText.value = max > 0 ? t("web.learn.grammar.limit", { limit: max }) : t("web.learn.grammar.notInPlan");
    } else if (err instanceof ApiError && err.code === "limit") {
      limit.value = { reason: err.body.reason as "plan" | "daily_ceiling", resetAt: err.body.resetAt };
    } else if (err instanceof ApiError && err.code === "too_long") {
      errorText.value = t("web.learn.grammar.tooLong", { max: MAX_TEXT });
    } else {
      errorText.value = t("web.learn.grammar.error");
    }
  } finally {
    busy.value = false;
  }
}
</script>

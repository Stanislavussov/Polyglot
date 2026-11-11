<template>
  <section class="space-y-4">
    <a href="/dictionary/" class="-my-2 inline-flex min-h-11 items-center gap-1 text-sm text-ink-muted hover:underline">
      <ChevronLeft class="size-4" aria-hidden="true" />{{ t("web.ask.back") }}
    </a>

    <p v-if="failed" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>
    <div v-else-if="!entry" class="card"><MonsterLoader :label="t('web.common.loading')" /></div>

    <template v-else>
      <!-- The same card the dictionary shows, so the learner knows which word this is about. -->
      <WordCard padding="md">
        <LangBadge :code="entry.sourceLang" />
        <WordHeadline class="pt-2" as="h1" :size="headlineSizeFor(entry.original)" :text="entry.original" :emoji="entry.emoji" />
        <template #body>
          <hr class="border-line" />
          <TranslationLines :lines="entry.translations" />
          <p v-if="entry.etymology" class="text-sm text-ink-muted">
            <span class="font-semibold">{{ t("web.dictionary.askEtymology") }}:</span> {{ entry.etymology }}
          </p>
        </template>
      </WordCard>


      <p v-if="lockedHint" role="alert" class="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">{{ t("web.explore.lockedHint") }}</p>
      <LimitNotice v-else-if="limit" :reason="limit.reason" :reset-at="limit.resetAt" />
      <p v-else-if="errorKey" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t(errorKey, errorParams) }}</p>

      <div class="space-y-3">
        <p v-if="thread.length === 0" class="text-base text-ink-muted">{{ t("web.ask.mentorIntro") }}</p>
        <ul class="space-y-2" aria-live="polite">
          <li
            v-for="(turn, index) in thread"
            :key="index"
            :class="turn.role === 'user' ? 'ml-8 bg-primary-soft text-primary-soft-fg' : 'mr-8 bg-surface-muted'"
            class="whitespace-pre-line break-words rounded-xl px-4 py-3 text-base"
          >
            <!-- Safe: mentorHtml escapes everything but bare <b>/<i>. -->
            <span v-if="turn.role === 'assistant'" v-html="mentorHtml(turn.content)" />
            <span v-else>{{ turn.content }}</span>
          </li>
          <li v-if="busy" class="mr-8 rounded-xl bg-surface-muted px-4 py-3 text-base text-ink-muted" role="status">{{ t("web.explore.thinking") }}</li>
        </ul>
        <div v-if="thread.length === 0" class="flex flex-wrap gap-2">
          <button v-for="key in STARTERS" :key="key" type="button" class="btn-secondary" :disabled="busy" @click="ask(t(key))">{{ t(key) }}</button>
        </div>
        <ComposerCard
          id="ask-question"
          v-model="question"
          :placeholder="t('web.explore.questionPlaceholder')"
          :submit-label="t('web.ask.send')"
          :max-length="2000"
          :busy="busy"
          @submit="ask(question)"
        />
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ChevronLeft } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import { mentorHtml } from "../lib/mentor-html";
import type { EntryDetail, MentorTurn } from "../lib/types";
import { headlineSizeFor } from "../lib/word-card";
import ComposerCard from "./ComposerCard.vue";
import LangBadge from "./LangBadge.vue";
import LimitNotice from "./LimitNotice.vue";
import MonsterLoader from "./MonsterLoader.vue";
import TranslationLines from "./word/TranslationLines.vue";
import WordCard from "./word/WordCard.vue";
import WordHeadline from "./word/WordHeadline.vue";

// One tap starts a useful conversation; typing is optional.
const STARTERS = ["web.ask.starterExplain", "web.ask.starterUsage", "web.ask.starterExamples"];

const params = new URLSearchParams(window.location.search);
const entryId = Number(params.get("id"));
const entry = ref<EntryDetail | null>(null);
const failed = ref(false);
const busy = ref(false);
const question = ref("");
const thread = ref<MentorTurn[]>([]);
const lockedHint = ref(false);
const limit = ref<{ reason?: "plan" | "daily_ceiling"; resetAt?: string } | null>(null);
const errorKey = ref<string | null>(null);
const errorParams = ref<Record<string, string | number>>({});


function resetNotices(): void {
  lockedHint.value = false;
  limit.value = null;
  errorKey.value = null;
  errorParams.value = {};
}

function showError(error: unknown): void {
  if (!(error instanceof ApiError)) errorKey.value = "web.common.error";
  else if (error.code === "feature_locked") lockedHint.value = true;
  else if (error.code === "limit")
    limit.value = { reason: error.body.reason === "daily_ceiling" ? "daily_ceiling" : "plan", resetAt: error.body.resetAt };
  else if (error.code === "mentor_limit") {
    errorKey.value = "web.explore.mentorLimit";
    errorParams.value = { limit: error.body.limit ?? 0 };
  } else if (error.status === 504) errorKey.value = "web.translate.timeout";
  else errorKey.value = "web.common.error";
}


async function ask(text: string): Promise<void> {
  const asked = text.trim();
  if (!asked || busy.value) return;
  busy.value = true;
  resetNotices();
  const history = thread.value;
  thread.value = [...history, { role: "user", content: asked }];
  question.value = "";
  try {
    const reply = await api.entryMentor(entryId, { question: asked, history });
    thread.value = [...thread.value, { role: "assistant", content: reply.answer }];
  } catch (error) {
    thread.value = history;
    question.value = asked;
    showError(error);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  if (!Number.isInteger(entryId) || entryId <= 0) {
    failed.value = true;
    return;
  }
  try {
    entry.value = await api.entry(entryId);
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <section class="space-y-4">
    <a href="/learn/" class="-my-2 inline-flex min-h-11 items-center text-sm text-ink-muted hover:underline">{{ t("web.learn.back") }}</a>
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-2xl font-bold tracking-tight">🧑‍🏫 {{ t("web.learn.mentor") }}</h1>
      <button type="button" class="btn-secondary" :disabled="busy || current.turns.length === 0" @click="startNew">
        {{ t("web.learn.mentor.newTopic") }}
      </button>
    </div>

    <p v-if="current.turns.length === 0" class="card text-base">{{ t("web.learn.mentor.intro") }}</p>
    <ul class="space-y-2" aria-live="polite">
      <li
        v-for="(turn, index) in current.turns"
        :key="index"
        :class="turn.role === 'user' ? 'ml-8 bg-primary-soft text-primary-soft-fg' : 'mr-8 bg-surface-muted'"
        class="whitespace-pre-line break-words rounded-xl px-4 py-3 text-base"
      >
        <!-- Safe: mentorHtml escapes everything but bare <b>/<i>. -->
        <span v-if="turn.role === 'assistant'" v-html="mentorHtml(turn.content)" />
        <span v-else>{{ turn.content }}</span>
      </li>
      <li v-if="busy" class="mr-8 rounded-xl bg-surface-muted px-4 py-3 text-base text-ink-muted" role="status">
        {{ t("web.explore.thinking") }}
      </li>
    </ul>

    <p v-if="lockedHint" role="alert" class="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">
      {{ t("web.explore.lockedHint") }}
    </p>
    <LimitNotice v-else-if="limit" :reason="limit.reason" :reset-at="limit.resetAt" />
    <p v-else-if="errorText" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ errorText }}</p>

    <form class="space-y-2" @submit.prevent="ask">
      <label class="sr-only" for="mentor-question">{{ t("web.explore.questionPlaceholder") }}</label>
      <textarea
        id="mentor-question"
        v-model="question"
        class="field min-h-20 resize-y"
        rows="3"
        :maxlength="MAX_QUESTION"
        :placeholder="t('web.explore.questionPlaceholder')"
        @keydown.enter.exact.prevent="ask"
      />
      <button type="submit" class="btn-primary" :disabled="busy || question.trim() === ''">
        {{ t("web.explore.send") }}
      </button>
    </form>

    <section v-if="earlier.length > 0" class="space-y-2 border-t border-line pt-4">
      <h2 class="text-sm font-semibold text-ink-muted">{{ t("web.learn.mentor.history") }}</h2>
      <ul class="space-y-1">
        <li v-for="thread in earlier" :key="thread.id">
          <button type="button" class="w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-muted" @click="resume(thread)">
            {{ thread.title }}
          </button>
        </li>
      </ul>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { learnApi } from "../lib/learn-api";
import { mentorHtml } from "../lib/mentor-html";
import { loadThreads, type MentorThread, newThread, saveThread } from "../lib/mentor-threads";
import LimitNotice from "./LimitNotice.vue";

const MAX_QUESTION = 1000;
// The bot's mentor window; the server trims to it too, this keeps the request small.
const MAX_WINDOW = 20;

const threads = ref<MentorThread[]>(loadThreads());
const current = ref<MentorThread>(newThread(""));
const question = ref("");
const busy = ref(false);
const lockedHint = ref(false);
const limit = ref<{ reason?: "plan" | "daily_ceiling"; resetAt?: string } | null>(null);
const errorText = ref<string | null>(null);

const earlier = computed(() => threads.value.filter((thread) => thread.id !== current.value.id));

function startNew(): void {
  current.value = newThread("");
  resetNotices();
}

function resume(thread: MentorThread): void {
  current.value = { ...thread, turns: [...thread.turns] };
  resetNotices();
}

function resetNotices(): void {
  lockedHint.value = false;
  limit.value = null;
  errorText.value = null;
}

async function ask(): Promise<void> {
  const text = question.value.trim();
  if (!text || busy.value) return;
  resetNotices();
  busy.value = true;
  const thread = current.value.turns.length === 0 ? { ...newThread(text), id: current.value.id } : current.value;
  try {
    const { answer } = await learnApi.mentorChat(text, thread.turns.slice(-MAX_WINDOW));
    const turns = [...thread.turns, { role: "user" as const, content: text }, { role: "assistant" as const, content: answer }];
    current.value = { ...thread, turns, updatedAt: Date.now() };
    threads.value = saveThread(threads.value, current.value);
    question.value = "";
  } catch (err) {
    if (err instanceof ApiError && err.code === "feature_locked") lockedHint.value = true;
    else if (err instanceof ApiError && err.code === "mentor_limit")
      errorText.value = t("web.learn.mentor.limit", { limit: err.body.limit ?? "" });
    else if (err instanceof ApiError && err.code === "limit")
      limit.value = { reason: err.body.reason as "plan" | "daily_ceiling", resetAt: err.body.resetAt };
    else if (err instanceof ApiError && err.code === "too_long")
      errorText.value = t("web.learn.mentor.tooLong", { max: MAX_QUESTION });
    else errorText.value = t("web.learn.mentor.error");
  } finally {
    busy.value = false;
  }
}
</script>

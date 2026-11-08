<template>
  <div class="space-y-4 border-t border-line pt-4">
    <section v-if="etymology" class="space-y-1 rounded-xl bg-surface-muted px-4 py-3 text-sm">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.explore.etymology") }}</h3>
      <p class="whitespace-pre-line">{{ etymology }}</p>
    </section>

    <button type="button" class="btn-secondary" :aria-expanded="open" @click="open = !open">
      {{ t(exploreKey) }}
    </button>

    <div v-if="open" class="space-y-3">
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-secondary" :disabled="busy !== null" @click="toggle('clarify')">
          {{ t("web.explore.clarify") }}<LockBadge v-if="locked('clarification')" />
        </button>
        <button type="button" class="btn-secondary" :disabled="busy !== null" @click="otherMeaning">
          {{ busy === "other" ? t("web.translate.working") : t("web.explore.otherMeaning") }}<LockBadge v-if="locked('clarification')" />
        </button>
        <button type="button" class="btn-secondary" :disabled="busy !== null" @click="toggle('mentor')">
          {{ t("web.explore.mentor") }}<LockBadge v-if="locked('mentor')" />
        </button>
        <button
          v-if="result.etymologyEligible && !etymology"
          type="button"
          class="btn-secondary"
          :disabled="busy !== null"
          @click="loadEtymology"
        >
          {{ busy === "etymology" ? t("web.translate.working") : t("web.explore.etymology") }}<LockBadge v-if="locked('etymology')" />
        </button>
      </div>

      <p v-if="lockedHint" role="alert" class="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">
        {{ t("web.explore.lockedHint") }}
      </p>
      <LimitNotice v-else-if="limit" :reason="limit.reason" :reset-at="limit.resetAt" />
      <p v-else-if="errorKey" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
        {{ t(errorKey, errorParams) }}
      </p>

      <form v-if="panel === 'clarify'" class="space-y-2" @submit.prevent="clarify">
        <label class="text-sm" for="explore-clarify">{{ t("web.explore.clarifyPrompt") }}</label>
        <input id="explore-clarify" v-model="clarifyText" class="field" maxlength="200" autocomplete="off" />
        <div class="flex gap-2">
          <button type="submit" class="btn-primary" :disabled="busy !== null || clarifyText.trim() === ''">
            {{ busy === "clarify" ? t("web.translate.working") : t("web.explore.clarifySubmit") }}
          </button>
          <button type="button" class="btn-secondary" @click="panel = null">{{ t("web.explore.cancel") }}</button>
        </div>
      </form>

      <section v-if="panel === 'mentor'" class="space-y-3" aria-live="polite">
        <p v-if="thread.length === 0" class="text-sm">{{ t("web.explore.mentorPrompt", { text: headword }) }}</p>
        <ul class="space-y-2">
          <li
            v-for="(turn, index) in thread"
            :key="index"
            :class="turn.role === 'user' ? 'ml-8 bg-primary-soft text-primary-soft-fg' : 'mr-8 bg-surface-muted'"
            class="whitespace-pre-line break-words rounded-xl px-4 py-3 text-sm"
          >
            <!-- Safe: mentorHtml escapes everything but bare <b>/<i>. -->
            <span v-if="turn.role === 'assistant'" v-html="mentorHtml(turn.content)" />
            <span v-else>{{ turn.content }}</span>
          </li>
          <li v-if="busy === 'mentor'" class="mr-8 rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink-muted" role="status">
            {{ t("web.explore.thinking") }}
          </li>
        </ul>
        <form class="space-y-2" @submit.prevent="ask(question)">
          <label class="sr-only" for="explore-question">{{ t("web.explore.questionPlaceholder") }}</label>
          <textarea
            id="explore-question"
            v-model="question"
            class="field min-h-20 resize-y"
            rows="2"
            :maxlength="MAX_QUESTION"
            :placeholder="t('web.explore.questionPlaceholder')"
            @keydown.enter.exact.prevent="ask(question)"
          />
          <div class="flex flex-wrap gap-2">
            <button type="submit" class="btn-primary" :disabled="busy !== null || question.trim() === ''">
              {{ t("web.explore.send") }}
            </button>
            <button v-if="thread.length === 0" type="button" class="btn-secondary" :disabled="busy !== null" @click="ask(null)">
              {{ t("web.explore.explain") }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref, watch } from "vue";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import { mentorHtml } from "../lib/mentor-html";
import type { CardFeatures, MentorTurn, TranslateAnswer, TranslateResult } from "../lib/types";
import LimitNotice from "./LimitNotice.vue";

const MAX_QUESTION = 1000;
// The bot's mentor window; the server trims to it too, this keeps the request small.
const MAX_THREAD = 20;

const props = defineProps<{ result: TranslateResult }>();
const emit = defineEmits<{ replace: [result: TranslateResult] }>();

const LockBadge = defineComponent(() => () => h("span", { class: "ml-1 text-xs", title: t("web.explore.locked") }, "💎"));

const open = ref(false);
const panel = ref<"clarify" | "mentor" | null>(null);
const busy = ref<"clarify" | "other" | "etymology" | "mentor" | null>(null);
const clarifyText = ref("");
const question = ref("");
const etymology = ref<string | null>(null);
const thread = ref<MentorTurn[]>([]);
const lockedHint = ref(false);
const limit = ref<{ reason?: "plan" | "daily_ceiling"; resetAt?: string } | null>(null);
const errorKey = ref<string | null>(null);
const errorParams = ref<Record<string, string | number>>({});
// Every translation shown for this word, so "Other meaning" keeps finding new senses.
let seen: Record<string, string[]> = {};
let keepSeen = false;

const headword = computed(() => props.result.sourceUsage?.headword ?? props.result.original);
const exploreKey = computed(() =>
  props.result.sentence
    ? "web.explore.sentence"
    : props.result.inputType === "phrase"
      ? "web.explore.phrase"
      : "web.explore.word",
);

watch(
  () => props.result,
  () => {
    if (!keepSeen) seen = {};
    // A new card from this panel's own action opens with the actions still showing.
    open.value = keepSeen;
    keepSeen = false;
    panel.value = null;
    etymology.value = null;
    thread.value = [];
    clarifyText.value = "";
    resetNotices();
  },
);

function locked(feature: keyof CardFeatures): boolean {
  return props.result.features?.[feature] === false;
}

function resetNotices(): void {
  lockedHint.value = false;
  limit.value = null;
  errorKey.value = null;
  errorParams.value = {};
}

function toggle(next: "clarify" | "mentor"): void {
  resetNotices();
  if (locked(next === "clarify" ? "clarification" : "mentor")) {
    lockedHint.value = true;
    return;
  }
  panel.value = panel.value === next ? null : next;
}

function showError(error: unknown): void {
  if (!(error instanceof ApiError)) {
    errorKey.value = "web.common.error";
  } else if (error.code === "feature_locked") {
    lockedHint.value = true;
  } else if (error.code === "limit") {
    limit.value = { reason: error.body.reason === "daily_ceiling" ? "daily_ceiling" : "plan", resetAt: error.body.resetAt };
  } else if (error.code === "mentor_limit") {
    errorKey.value = "web.explore.mentorLimit";
    errorParams.value = { limit: error.body.limit ?? 0 };
  } else if (error.code === "no_more_meanings") {
    errorKey.value = "web.explore.noMoreMeanings";
  } else if (error.status === 504) {
    errorKey.value = "web.translate.timeout";
  } else {
    errorKey.value = "web.common.error";
  }
}

async function retranslate(kind: "clarify" | "other", answer: TranslateAnswer): Promise<void> {
  busy.value = kind;
  resetNotices();
  try {
    const fresh = await api.translate(props.result.original, { sourceLang: props.result.sourceLang, ...answer });
    keepSeen = kind === "other";
    emit("replace", fresh);
  } catch (error) {
    showError(error);
  } finally {
    busy.value = null;
  }
}

function clarify(): void {
  void retranslate("clarify", { context: clarifyText.value.trim(), clarify: true });
}

function otherMeaning(): void {
  if (locked("clarification")) {
    resetNotices();
    lockedHint.value = true;
    return;
  }
  for (const translation of props.result.translations) {
    seen[translation.lang] = [...(seen[translation.lang] ?? []), translation.text];
  }
  void retranslate("other", {
    negativeConstraints: seen,
    ...(props.result.context ? { context: props.result.context } : {}),
  });
}

async function loadEtymology(): Promise<void> {
  resetNotices();
  if (locked("etymology")) {
    lockedHint.value = true;
    return;
  }
  busy.value = "etymology";
  try {
    const { etymology: text } = await api.etymology({
      original: props.result.original,
      sourceLang: props.result.sourceLang,
      inputType: props.result.inputType === "phrase" ? "phrase" : "word",
    });
    etymology.value = text;
  } catch (error) {
    showError(error);
  } finally {
    busy.value = null;
  }
}

async function ask(typed: string | null): Promise<void> {
  const text = typed?.trim() ?? "";
  if (busy.value !== null || (typed !== null && text === "")) return;
  busy.value = "mentor";
  resetNotices();
  const history = thread.value.slice(-MAX_THREAD);
  try {
    const reply = await api.mentor({
      card: props.result,
      ...(typed === null ? { explain: true } : { question: text }),
      ...(etymology.value ? { etymology: etymology.value } : {}),
      history,
    });
    thread.value = [...history, { role: "user", content: reply.question }, { role: "assistant", content: reply.answer }];
    question.value = "";
  } catch (error) {
    showError(error);
  } finally {
    busy.value = null;
  }
}
</script>

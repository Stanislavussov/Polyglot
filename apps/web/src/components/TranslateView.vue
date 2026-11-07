<template>
  <section class="pb-24 md:pb-0">
    <h1 class="text-2xl font-bold tracking-tight">{{ t("web.translate.title") }}</h1>

    <div class="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] xl:items-start">
      <form class="card space-y-3 xl:col-start-1 xl:row-start-1" @submit.prevent="submit()">
        <label class="sr-only" for="translate-input">{{ t("web.translate.placeholder") }}</label>
        <textarea
          id="translate-input"
          ref="input"
          v-model="text"
          class="field min-h-28 resize-y focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-ring"
          rows="3"
          :maxlength="MAX_LENGTH"
          :placeholder="t('web.translate.placeholder')"
          @keydown="onKeydown"
        />
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs text-ink-muted" aria-hidden="true">{{ text.length }}/{{ MAX_LENGTH }}</span>
          <div class="flex gap-2">
            <button v-if="text !== ''" type="button" class="btn-secondary" @click="clearInput">
              {{ t("web.translate.clear") }}
            </button>
            <!-- On phones the button sits at the bottom of the screen, within thumb reach and above the keyboard. -->
            <button
              type="submit"
              class="btn-primary fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 py-3 shadow-lg md:static md:inset-auto md:py-2 md:shadow-none"
              :disabled="busy || text.trim() === ''"
            >
              {{ busy ? t("web.translate.working") : t("web.translate.submit") }}
            </button>
          </div>
        </div>
        <p class="text-xs text-ink-muted">{{ t("web.translate.hint") }}</p>
      </form>

      <div class="min-w-0 xl:col-start-1 xl:row-start-2" aria-live="polite">
        <LimitNotice v-if="limit" :reason="limit.reason" :reset-at="limit.resetAt" />
        <div v-else-if="clarification" class="card space-y-4" role="alert">
          <p class="text-sm">{{ clarification.view.message }}</p>
          <div v-if="languageChoices.length > 0" class="flex flex-wrap gap-2">
            <button
              v-for="code in languageChoices"
              :key="code"
              type="button"
              class="btn-secondary"
              @click="answer(clarification.text, { sourceLang: code })"
            >
              <span aria-hidden="true">{{ languageFlag(code) }}</span>{{ languageName(code) }}
            </button>
          </div>
          <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              v-for="option in answerOptions"
              :key="option.kind + option.value"
              type="button"
              :class="option.kind === 'typo_correction' ? 'btn-primary' : 'btn-secondary'"
              @click="pick(option)"
            >
              {{ option.kind === "translate_as_written" ? t("web.translate.asWritten") : option.label }}
            </button>
          </div>
        </div>
        <div v-else-if="languageQuestion" class="card space-y-4" role="alert">
          <p class="text-sm">
            {{ t(languageQuestion.kind === "ambiguous" ? "web.translate.whichLanguage" : "web.translate.unknownLanguage", { word: languageQuestion.text }) }}
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="code in languageQuestion.languages"
              :key="code"
              type="button"
              class="btn-secondary"
              @click="answer(languageQuestion.text, { sourceLang: code })"
            >
              <span aria-hidden="true">{{ languageFlag(code) }}</span>{{ languageName(code) }}
            </button>
          </div>
        </div>
        <div v-else-if="otherLanguage" role="alert" class="space-y-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">
          <p>
            {{ t(otherLanguage.supported ? "web.translate.addLanguage" : "web.translate.languageUnsupported", { lang: languageName(otherLanguage.lang) }) }}
          </p>
          <a v-if="otherLanguage.supported" href="/settings/" class="inline-flex min-h-11 items-center font-semibold underline">
            {{ t("web.translate.openSettings") }}
          </a>
        </div>
        <p v-else-if="errorKey" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {{ t(errorKey, errorParams) }}
        </p>

        <div v-if="busy" class="card space-y-4" aria-busy="true">
          <p class="text-sm font-medium text-ink-muted" role="status">{{ loaderText || t("web.translate.loading") }}</p>
          <div class="h-4 w-24 animate-pulse rounded bg-surface-muted" />
          <div class="h-7 w-2/3 animate-pulse rounded bg-surface-muted" />
          <div class="space-y-3 border-t border-line pt-4">
            <div class="h-4 w-20 animate-pulse rounded bg-surface-muted" />
            <div class="h-6 w-1/2 animate-pulse rounded bg-surface-muted" />
            <div class="h-4 w-full animate-pulse rounded bg-surface-muted" />
            <div class="h-4 w-5/6 animate-pulse rounded bg-surface-muted" />
          </div>
        </div>

        <article v-else-if="result" class="card space-y-5">
          <header class="space-y-3">
            <p class="text-sm text-ink-muted">
              <span aria-hidden="true">{{ languageFlag(result.sourceLang) }}</span>
              {{ languageName(result.sourceLang) }}
              <span aria-hidden="true">→</span>
              <span v-for="code in result.targetLangs" :key="code" class="ml-1 whitespace-nowrap">
                <span aria-hidden="true">{{ languageFlag(code) }}</span>
                <span class="sr-only">{{ languageName(code) }}</span>
              </span>
            </p>
            <h2 class="break-words text-xl font-semibold">
              <span v-if="result.emoji" class="mr-2" aria-hidden="true">{{ result.emoji }}</span>{{ result.sourceUsage?.headword ?? result.original }}
            </h2>

            <div v-if="result.correction" class="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">
              <p class="font-semibold">{{ t("web.translate.corrected", { corrected: result.correction.corrected }) }}</p>
              <p class="mt-1">{{ result.correction.explanation || t("web.translate.typoFixed", { word: result.correction.original }) }}</p>
            </div>
            <p v-if="result.unverified" class="flex items-start gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">
              <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {{ t("web.translate.unverified") }}
            </p>
            <p v-if="result.nativeMeaning" class="text-sm">
              <span class="font-semibold text-ink-muted">{{ t("web.translate.nativeMeaning") }}:</span>
              {{ result.nativeMeaning }}
            </p>

            <div v-if="result.sourceUsage" class="space-y-2 rounded-xl bg-surface-muted px-4 py-3 text-sm">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.translate.aboutSource") }}</h3>
              <p>{{ result.sourceUsage.explanation }}</p>
              <ul v-if="result.sourceUsage.synonyms.length > 0" class="flex flex-wrap gap-2">
                <li v-for="synonym in result.sourceUsage.synonyms" :key="synonym" class="rounded-full bg-primary-soft px-3 py-1 text-primary-soft-fg">
                  {{ synonym }}
                </li>
              </ul>
              <ExampleList :examples="result.sourceUsage.examples" />
            </div>
          </header>

          <div v-for="translation in result.translations" :key="translation.lang" class="border-t border-line pt-4">
            <p class="text-sm text-ink-muted">
              <span aria-hidden="true">{{ languageFlag(translation.lang) }}</span> {{ languageName(translation.lang) }}
            </p>
            <div class="mt-1 flex items-start justify-between gap-3">
              <p class="min-w-0 break-words text-lg font-semibold text-primary">
                {{ translation.text }}
                <span v-if="translation.expressionType" class="ml-2 inline-block rounded-full bg-primary-soft px-2 py-0.5 align-middle text-xs font-medium text-primary-soft-fg">
                  {{ translation.expressionType }}
                </span>
              </p>
              <button
                type="button"
                class="btn-secondary shrink-0 !px-3"
                :aria-label="t('web.translate.copyLabel', { text: translation.text })"
                @click="copy(translation)"
              >
                <Check v-if="copiedLang === translation.lang" class="size-4" aria-hidden="true" />
                <Copy v-else class="size-4" aria-hidden="true" />
                <span class="hidden sm:inline">{{ copiedLang === translation.lang ? t("web.translate.copied") : t("web.translate.copy") }}</span>
              </button>
            </div>

            <p v-if="translation.equivalentNote" class="mt-2 text-sm text-ink-muted">{{ translation.equivalentNote }}</p>
            <p v-if="translation.connotationWarning" class="mt-2 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-fg">
              <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {{ translation.connotationWarning }}
            </p>
            <ul v-if="translation.synonyms.length > 0" class="mt-3 flex flex-wrap gap-2" :aria-label="t('web.translate.synonyms')">
              <li v-for="synonym in translation.synonyms" :key="synonym" class="rounded-full bg-primary-soft px-3 py-1 text-sm text-primary-soft-fg">
                {{ synonym }}
              </li>
            </ul>
            <ExampleList class="mt-3" :examples="translation.examples.slice(0, 1)" />

            <template v-if="hasMore(translation)">
              <div v-if="expanded.has(translation.lang)" :id="`more-${translation.lang}`" class="mt-3 space-y-3">
                <p v-if="translation.usageNote" class="text-sm">{{ translation.usageNote }}</p>
                <div v-if="translation.alternatives.length > 0">
                  <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.translate.alternatives") }}</h3>
                  <ul class="mt-1 flex flex-wrap gap-2">
                    <li v-for="alternative in translation.alternatives" :key="alternative" class="rounded-full border border-line px-3 py-1 text-sm">
                      {{ alternative }}
                    </li>
                  </ul>
                </div>
                <ExampleList v-if="translation.examples.length > 1" :examples="translation.examples.slice(1)" />
              </div>
              <button
                type="button"
                class="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"
                :aria-expanded="expanded.has(translation.lang)"
                :aria-controls="`more-${translation.lang}`"
                @click="toggle(translation.lang)"
              >
                <ChevronDown class="size-4 transition-transform" :class="{ 'rotate-180': expanded.has(translation.lang) }" aria-hidden="true" />
                {{ expanded.has(translation.lang) ? t("web.translate.showLess") : t("web.translate.showMore") }}
              </button>
            </template>
          </div>

          <div v-if="saveControls" class="flex flex-wrap items-center gap-3 border-t border-line pt-4 text-sm">
            <template v-if="saveState === 'removed'">
              <span class="text-ink-muted">{{ t("web.translate.removed") }}</span>
              <button type="button" class="btn-secondary" :disabled="savePending" @click="setSaved(true)">
                <Undo2 class="size-4" aria-hidden="true" />{{ t("web.translate.undo") }}
              </button>
            </template>
            <template v-else>
              <span class="flex items-center gap-2 text-primary-soft-fg">
                <Check class="size-4" aria-hidden="true" />{{ t("web.translate.savedToDictionary") }}
              </span>
              <button type="button" class="btn-secondary" :disabled="savePending" @click="setSaved(false)">
                <Trash2 class="size-4" aria-hidden="true" />{{ t("web.translate.remove") }}
              </button>
            </template>
          </div>
        </article>
      </div>

      <div class="card xl:col-start-2 xl:row-span-2 xl:row-start-1">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold">{{ t("web.translate.recent") }}</h2>
          <button v-if="history.length > 0" type="button" class="min-h-11 text-sm font-semibold text-primary hover:text-primary-hover" @click="clearHistory">
            {{ t("web.translate.clearHistory") }}
          </button>
        </div>
        <p v-if="history.length === 0" class="mt-2 text-sm text-ink-muted">{{ t("web.translate.recentEmpty") }}</p>
        <ul v-else class="mt-2 divide-y divide-line">
          <li v-for="item in history" :key="historyKey(item)" class="flex items-center gap-2">
            <button type="button" class="flex min-h-11 min-w-0 flex-1 items-center py-2 text-left hover:text-primary" @click="openHistory(item)">
              <span class="min-w-0 truncate font-medium"><span v-if="item.emoji" class="mr-2" aria-hidden="true">{{ item.emoji }}</span>{{ item.original }}</span>
            </button>
            <button
              type="button"
              class="inline-flex size-11 shrink-0 items-center justify-center text-ink-muted hover:text-danger"
              :aria-label="t('web.translate.removeFromHistory', { word: item.original })"
              :title="t('web.translate.removeFromHistory', { word: item.original })"
              @click="forget(item)"
            >
              <Trash2 class="size-4" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Check, ChevronDown, Copy, Trash2, TriangleAlert, Undo2 } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useLoaderText } from "../lib/use-loader-text";
import { useMainInput } from "../lib/use-main-input";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import { languageFlag, languageName } from "../lib/settings-store";
import type { Clarification, ClarificationOption, TranslateAnswer, TranslateResult, TranslateTarget } from "../lib/types";
import ExampleList from "./ExampleList.vue";
import LimitNotice from "./LimitNotice.vue";

const MAX_LENGTH = 500;
const HISTORY_SIZE = 10;
const HISTORY_KEY = "polyglot.translate.history";
const COPIED_MS = 1800;

const input = ref<HTMLTextAreaElement | null>(null);
const text = ref("");
const { focus: focusInput } = useMainInput(() => input.value);
const busy = ref(false);
const loaderText = useLoaderText(busy);
const result = ref<TranslateResult | null>(null);
const fromHistory = ref(false);
const errorKey = ref<string | null>(null);
const errorParams = ref<Record<string, string | number>>({});
const languageQuestion = ref<{ text: string; kind: "ambiguous" | "unrecognized"; languages: string[] } | null>(null);
const otherLanguage = ref<{ lang: string; supported: boolean } | null>(null);
const clarification = ref<{ text: string; view: Clarification } | null>(null);
const languageChoices = computed(() => {
  const view = clarification.value?.view;
  if (!view) return [];
  const offered = view.options.flatMap((option) => (option.kind === "source_language" && option.langCode ? [option.langCode] : []));
  return offered.length > 0 ? offered : view.languages;
});
const answerOptions = computed(() =>
  (clarification.value?.view.options ?? []).filter((option) => !(option.kind === "source_language" && option.langCode)),
);
const limit = ref<{ reason?: "plan" | "daily_ceiling"; resetAt?: string } | null>(null);
const history = ref<TranslateResult[]>([]);
const expanded = ref(new Set<string>());
const copiedLang = ref<string | null>(null);
const saveState = ref<"saved" | "removed">("saved");
const savePending = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

// A stored result has no live connection to the dictionary, so its save controls would act on stale state.
const saveControls = computed(() => result.value?.savedEntryId != null && !fromHistory.value);

function isStoredResult(value: unknown): value is TranslateResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TranslateResult>;
  return typeof candidate.original === "string" && Array.isArray(candidate.translations) && Array.isArray(candidate.targetLangs);
}

function loadHistory(): TranslateResult[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isStoredResult).slice(0, HISTORY_SIZE) : [];
  } catch {
    return [];
  }
}

function persistHistory(): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value));
  } catch {
    // Storage can be blocked or full; history then lasts for this page only.
  }
}

function historyKey(item: TranslateResult): string {
  return `${item.sourceLang}:${item.original.toLowerCase()}`;
}

function remember(entry: TranslateResult): void {
  const key = historyKey(entry);
  history.value = [entry, ...history.value.filter((item) => historyKey(item) !== key)].slice(0, HISTORY_SIZE);
  persistHistory();
}

function forget(entry: TranslateResult): void {
  const key = historyKey(entry);
  history.value = history.value.filter((item) => historyKey(item) !== key);
  persistHistory();
}

function clearHistory(): void {
  history.value = [];
  persistHistory();
}

function show(entry: TranslateResult, stored: boolean): void {
  result.value = entry;
  fromHistory.value = stored;
  saveState.value = "saved";
  expanded.value = new Set();
}

const REJECT_KEYS: Record<string, string> = {
  empty: "web.translate.rejected.empty",
  needs_text: "web.translate.rejected.needsText",
  emoji: "web.translate.rejected.emoji",
  command: "web.translate.rejected.command",
  digits: "web.translate.rejected.digits",
  tooLong: "web.translate.rejected.tooLong",
};

function resetNotices(): void {
  errorKey.value = null;
  errorParams.value = {};
  clarification.value = null;
  languageQuestion.value = null;
  otherLanguage.value = null;
  limit.value = null;
}

function openHistory(entry: TranslateResult): void {
  resetNotices();
  show(entry, true);
  focusInput();
}

function hasMore(translation: TranslateTarget): boolean {
  return Boolean(translation.usageNote) || translation.alternatives.length > 0 || translation.examples.length > 1;
}

function toggle(lang: string): void {
  const next = new Set(expanded.value);
  if (!next.delete(lang)) next.add(lang);
  expanded.value = next;
}

async function copy(translation: TranslateTarget): Promise<void> {
  try {
    await navigator.clipboard.writeText(translation.text);
  } catch {
    return;
  }
  copiedLang.value = translation.lang;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedLang.value = null;
  }, COPIED_MS);
}

async function setSaved(saved: boolean): Promise<void> {
  const entryId = result.value?.savedEntryId;
  if (entryId == null || savePending.value) return;
  savePending.value = true;
  errorKey.value = null;
  try {
    await (saved ? api.restoreEntry(entryId) : api.removeEntry(entryId));
    saveState.value = saved ? "saved" : "removed";
  } catch {
    errorKey.value = "web.common.error";
  } finally {
    savePending.value = false;
  }
}

function clearInput(): void {
  text.value = "";
  focusInput();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    clearInput();
  } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void submit();
  }
}

async function submit(): Promise<void> {
  await answer(text.value.trim(), {});
}

/** Mirrors the bot's clarify buttons: each answer re-runs the translation with what the user chose. */
function pick(option: ClarificationOption): void {
  const pending = clarification.value;
  if (!pending) return;
  const sourceLang = option.langCode ?? pending.view.sourceLang;
  if (option.kind === "typo_correction" && option.correctedText) {
    text.value = option.correctedText;
    void answer(option.correctedText, { sourceLang, asWritten: true });
  } else if (option.kind === "translate_as_written") {
    void answer(pending.text, { sourceLang, asWritten: true });
  } else {
    void answer(pending.text, { sourceLang, context: `${option.label ?? option.value}: ${option.value}` });
  }
}

async function answer(value: string, choice: TranslateAnswer): Promise<void> {
  if (busy.value || value === "") return;
  busy.value = true;
  resetNotices();
  try {
    const fresh = await api.translate(value, choice);
    show(fresh, false);
    remember(fresh);
  } catch (error) {
    result.value = null;
    if (error instanceof ApiError && error.status === 429 && error.code === "limit") {
      limit.value = { reason: error.body.reason === "daily_ceiling" ? "daily_ceiling" : "plan", resetAt: error.body.resetAt };
    } else if (error instanceof ApiError && error.code === "needs_language" && error.body.languages?.length) {
      languageQuestion.value = {
        text: error.body.text ?? value,
        kind: error.body.kind ?? "ambiguous",
        languages: error.body.languages,
      };
    } else if (error instanceof ApiError && error.code === "add_language" && error.body.lang) {
      otherLanguage.value = { lang: error.body.lang, supported: error.body.supported === true };
    } else if (error instanceof ApiError && error.code === "rejected") {
      errorKey.value = REJECT_KEYS[error.body.reason ?? ""] ?? "web.common.error";
      errorParams.value = { max: error.body.maxLength ?? MAX_LENGTH };
    } else if (error instanceof ApiError && error.code === "no_languages") {
      errorKey.value = "web.translate.noLanguages";
    } else if (error instanceof ApiError && error.code === "needs_clarification" && error.body.message) {
      clarification.value = {
        text: value,
        view: {
          message: error.body.message,
          sourceLang: error.body.sourceLang ?? "",
          options: error.body.options ?? [],
          languages: error.body.languages ?? [],
        },
      };
    } else if (error instanceof ApiError && error.code === "needs_clarification") {
      errorKey.value = "web.translate.clarify";
    } else if (error instanceof ApiError && error.code === "timeout") {
      errorKey.value = "web.translate.timeout";
    } else {
      errorKey.value = "web.common.error";
    }
  } finally {
    busy.value = false;
    focusInput();
  }
}

onMounted(() => {
  history.value = loadHistory();
});
</script>

<template>
  <section>
    <h1 class="page-title">{{ t("web.translate.title") }}</h1>

    <div class="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] xl:items-start">
      <ComposerCard
        id="translate-input"
        ref="composer"
        v-model="text"
        class="xl:col-start-1 xl:row-start-1"
        :placeholder="t('web.translate.placeholder')"
        :submit-label="t('web.translate.submit')"
        :max-length="MAX_LENGTH"
        :busy="busy"
        :voice="recording ? 'recording' : transcribing ? 'processing' : null"
        @submit="submit()"
        @voice-send="finishRecording(true)"
      >
        <template #tools>
          <!-- Idle: the mic. Recording: Stop puts the words into the box to check first; the send button sends at once. -->
          <button
            v-if="voiceAvailable"
            type="button"
            class="grid size-11 shrink-0 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            :class="recording ? 'bg-surface-muted text-ink hover:bg-primary-soft' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'"
            :aria-label="recording ? t('web.voice.stop') : t('web.voice.record')"
            :title="recording ? t('web.voice.stop') : t('web.voice.record')"
            :disabled="busy || transcribing"
            @mousedown.prevent
            @click="recording ? finishRecording(false) : startRecording()"
          >
            <Square v-if="recording" class="size-5" fill="currentColor" aria-hidden="true" /><Mic v-else class="size-5" aria-hidden="true" />
          </button>
        </template>
        <template #voice>
          <VoiceWave
            :level="voiceLevel"
            :processing="transcribing"
            :label="transcribing ? t('web.voice.processing') : t('web.voice.listening')"
          />
        </template>
        <template #notice>
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
                <LangFlag :code="code" />{{ languageName(code) }}
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
                <LangFlag :code="code" />{{ languageName(code) }}
              </button>
            </div>
          </div>
          <div v-else-if="otherLanguage" role="alert" class="space-y-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">
            <p>
              <LangFlag :code="otherLanguage.lang" />
              {{ t(otherLanguage.supported ? "web.translate.addLanguage" : "web.translate.languageUnsupported", { lang: languageName(otherLanguage.lang) }) }}
            </p>
            <template v-if="!otherLanguage.supported && otherLanguage.languages.length > 0">
              <p>{{ t("web.translate.pickOwnLanguage") }}</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="code in otherLanguage.languages"
                  :key="code"
                  type="button"
                  class="btn-secondary"
                  @click="answer(otherLanguage.text, { sourceLang: code })"
                >
                  <LangFlag :code="code" />{{ languageName(code) }}
                </button>
              </div>
            </template>
            <button
              v-if="otherLanguage.supported"
              type="button"
              class="btn-primary"
              @click="answer(otherLanguage.text, { addLanguage: otherLanguage.lang })"
            >
              {{ t("web.translate.addAndTranslate", { lang: languageName(otherLanguage.lang) }) }}
            </button>
            <a v-if="otherLanguage.supported" href="/settings/" class="inline-flex min-h-11 items-center font-semibold underline">
              {{ t("web.translate.openSettings") }}
            </a>
          </div>
          <p v-else-if="errorKey" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {{ t(errorKey, errorParams) }}
          </p>
        </template>
        <!-- Touch keyboards have no Shift+Enter, so the hint only misleads there. -->
        <p class="mt-2 hidden truncate px-3 text-sm text-ink-muted md:block [@media(pointer:coarse)]:hidden">{{ t("web.translate.hint") }}</p>
      </ComposerCard>

      <div class="min-w-0 xl:col-start-1 xl:row-start-2" aria-live="polite">

        <div v-if="busy && !preview" class="card space-y-4" aria-busy="true">
          <MonsterLoader compact :label="loaderText || t('web.translate.loading')" />
        </div>

        <article v-else-if="card" class="card space-y-5" :aria-busy="pending">
          <header class="space-y-3">
            <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 flex-1 items-center gap-2.5 text-sm">
              <LangBadge :code="card.sourceLang" />
              <!-- Target languages as an overlapping stack: names live in the tooltip and for screen readers. -->
              <span class="flex shrink-0 items-center -space-x-1.5" :title="card.targetLangs.map(languageName).join(', ')">
                <span v-for="code in card.targetLangs" :key="code" class="rounded-full ring-2 ring-surface">
                  <LangFlag :code="code" />
                  <span class="sr-only">{{ languageName(code) }}</span>
                </span>
              </span>
            </div>
            <div class="flex shrink-0 items-center gap-2 text-sm">
              <template v-if="saveControls">
                <!-- Several dictionaries: Save asks where to; with only one it saves straight away. -->
                <DropdownMenuRoot v-if="saveState === 'unsaved' && dictionaries.length > 1">
                  <DropdownMenuTrigger :class="SAVE_BTN" :disabled="savePending" :title="t('web.translate.save')" :aria-label="t('web.translate.save')">
                    <BookmarkPlus class="size-4" stroke-width="2.5" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.translate.save") }}</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent align="end" :side-offset="8" :collision-padding="16" class="z-50 min-w-60 rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
                      <DropdownMenuLabel class="px-3 pb-1 pt-2 text-sm text-ink-muted">{{ t("web.translate.saveTo") }}</DropdownMenuLabel>
                      <DropdownMenuItem
                        v-for="dictionary in dictionaries"
                        :key="dictionary.id"
                        class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-base outline-none data-[highlighted]:bg-surface-muted"
                        @select="save(dictionary)"
                      >
                        <span class="w-6 text-center text-xl" aria-hidden="true">{{ dictionary.icon ?? "📘" }}</span>
                        <span class="min-w-0 flex-1 truncate">{{ dictionary.name }}</span>
                        <span class="text-sm text-ink-muted">{{ dictionary.count }}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenuRoot>
                <button
                  v-else-if="saveState === 'unsaved'"
                  type="button"
                  :class="SAVE_BTN"
                  :disabled="savePending"
                  :title="t('web.translate.save')"
                  :aria-label="t('web.translate.save')"
                  @click="save()"
                >
                  <BookmarkPlus class="size-4" stroke-width="2.5" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.translate.save") }}</span>
                </button>
                <!-- Removed: the save button comes back, and pressing it is the undo — no extra pill to reflow the header. -->
                <template v-else-if="saveState === 'removed'">
                  <button
                    type="button"
                    :class="SAVE_BTN"
                    :disabled="savePending"
                    :title="t('web.translate.undo')"
                    :aria-label="t('web.translate.undo')"
                    @click="setSaved(true)"
                  >
                    <BookmarkPlus class="size-4" stroke-width="2.5" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.translate.save") }}</span>
                  </button>
                </template>
                <!-- Saved: the button turns into the opposite action, in red, so the two states never look alike. -->
                <button
                  v-else
                  type="button"
                  :class="SAVED_BTN"
                  :disabled="savePending"
                  :title="t('web.translate.removeFromDictionary')"
                  :aria-label="t('web.translate.removeFromDictionary')"
                  @click="setSaved(false)"
                >
                  <Trash2 class="size-4" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.translate.removeFromDictionary") }}</span>
                </button>
              </template>
              <DropdownMenuRoot v-if="!pending && explore && explore.actions.length > 0">
                <DropdownMenuTrigger :class="EXPLORE_BTN" :title="explore.menuLabel" :aria-label="explore.menuLabel">
                  <Sparkles class="size-4" aria-hidden="true" /><span class="hidden sm:inline">{{ explore.menuLabel }}</span>
                </DropdownMenuTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuContent align="end" :side-offset="8" :collision-padding="16" :class="MENU" @close-auto-focus.prevent>
                    <ActionMenuItem v-for="action in explore.actions" :key="action.key" :action="action" />
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenuRoot>
            </div>
            </div>
            <WordHeadline as="h2" :text="card.sourceUsage?.headword ?? card.original" :emoji="card.emoji" />
            <!-- Everything about the word in its own language sits with the word, above the translations. -->
            <template v-if="card.sourceUsage">
              <ul v-if="card.sourceUsage.synonyms.length > 0" class="flex flex-wrap gap-2 text-sm" :aria-label="t('web.translate.aboutSource')">
                <li v-for="synonym in card.sourceUsage.synonyms" :key="synonym" class="rounded-full bg-primary-soft px-3 py-1 text-primary-soft-fg">
                  {{ synonym }}
                </li>
              </ul>
              <div class="space-y-2 rounded-xl bg-surface-muted px-4 py-3 text-sm">
                <p>{{ card.sourceUsage.explanation }}</p>
                <ExampleList :examples="card.sourceUsage.examples" />
              </div>
            </template>

            <div v-if="card.correction" class="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">
              <p class="font-semibold">{{ t("web.translate.corrected", { corrected: card.correction.corrected }) }}</p>
              <p class="mt-1">{{ card.correction.explanation || t("web.translate.typoFixed", { word: card.correction.original }) }}</p>
            </div>
            <p v-if="card.unverified" class="flex items-start gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">
              <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {{ t("web.translate.unverified") }}
            </p>
          </header>

          <MonsterLoader v-if="explore?.retranslating" compact :label="t('web.translate.loading')" />
          <template v-else>
          <TranslationBlock
            v-if="split.native"
            :key="`${resultSeq}:${split.native.lang}`"
            :translation="split.native"
            id-prefix="translate"
          />

          <div v-if="card.nativeMeaning" class="space-y-3">
            <p v-if="card.nativeMeaning" class="text-base">
              <span class="font-semibold text-ink-muted">{{ t("web.translate.nativeMeaning") }}:</span>
              {{ card.nativeMeaning }}
            </p>

          </div>

          <TranslationBlock
            v-for="translation in split.others"
            :key="`${resultSeq}:${translation.lang}`"
            :translation="translation"
            id-prefix="translate"
          />

          </template>

          <!-- The card so far is not checked yet: the rest is still on its way, and Save waits for the final card. -->
          <MonsterLoader v-if="pending" compact :label="loaderText || t('web.translate.loading')" />
          <CardExplore v-else ref="explore" :result="card" @replace="onReplace" />

        </article>
      </div>

      <div class="card xl:col-start-2 xl:row-span-2 xl:row-start-1">
        <div class="flex items-center justify-between gap-3">
          <h2 class="min-w-0 truncate text-sm font-bold">{{ t("web.translate.recent") }}</h2>
          <button v-if="history.length > 0" type="button" class="-mr-2 min-h-11 shrink-0 whitespace-nowrap rounded-full px-2 text-sm font-semibold text-primary hover:text-primary-hover" @click="clearHistory">
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
import WordHeadline from "./word/WordHeadline.vue";
import LangBadge from "./LangBadge.vue";
import LangFlag from "./LangFlag.vue";
import { ArrowRight, BookmarkPlus, Sparkles, Mic, Square, Trash2, TriangleAlert } from "lucide-vue-next";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "reka-ui";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useLoaderText } from "../lib/use-loader-text";
import { captureEarlyInput, earlyFocused, earlyText } from "../lib/early-input";
import { toast } from "../lib/toast";
import { useMainInput } from "../lib/use-main-input";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import { splitNative } from "../lib/card-order";
import { languageName, settings } from "../lib/settings-store";
import type { Clarification, ClarificationOption, Dictionary, TranslateAnswer, TranslateResult } from "../lib/types";
import { startWavRecording, type WavRecording } from "../lib/wav-recorder";
import { MENU } from "../lib/action-bar";
import ActionMenuItem from "./ActionMenuItem.vue";
import CardExplore from "./CardExplore.vue";
import ComposerCard from "./ComposerCard.vue";
import VoiceWave from "./VoiceWave.vue";
import ExampleList from "./ExampleList.vue";
import LimitNotice from "./LimitNotice.vue";
import MonsterLoader from "./MonsterLoader.vue";
import TranslationBlock from "./TranslationBlock.vue";

const MAX_LENGTH = 500;
const HISTORY_SIZE = 10;
const HISTORY_KEY = "polyglot.translate.history";

const composer = ref<InstanceType<typeof ComposerCard> | null>(null);
// Text typed into the loading page's early input carries over, caret and all.
captureEarlyInput();
const text = ref(earlyText.value);
const { focus: focusInput } = useMainInput(() => composer.value?.el ?? null);
const busy = ref(false);
const loaderText = useLoaderText(busy);
const result = ref<TranslateResult | null>(null);
// The card as it settles during a request; `card` is what the page shows.
const preview = ref<TranslateResult | null>(null);
const pending = computed(() => busy.value && preview.value !== null);
const card = computed(() => (busy.value ? preview.value : result.value));
const errorKey = ref<string | null>(null);
const errorParams = ref<Record<string, string | number>>({});
const languageQuestion = ref<{ text: string; kind: "ambiguous" | "unrecognized"; languages: string[] } | null>(null);
const otherLanguage = ref<{ lang: string; supported: boolean; text: string; languages: string[] } | null>(null);
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
// Bumped per shown result so each card opens folded, even when the same word is shown again.
const resultSeq = ref(0);
const saveState = ref<"unsaved" | "saved" | "removed">("unsaved");
const savePending = ref(false);

const split = computed(() => splitNative(card.value?.translations ?? [], settings.value?.nativeLang));
const saveControls = computed(
  () => !pending.value && !!result.value && (result.value.savedEntryId != null || !!result.value.saveToken),
);

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
  // The signed card stays, so a word reopened from history can still be saved.
  history.value = [{ ...entry }, ...history.value.filter((item) => historyKey(item) !== key)].slice(0, HISTORY_SIZE);
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

function show(entry: TranslateResult): void {
  result.value = entry;
  saveState.value = entry.savedEntryId != null ? "saved" : "unsaved";
  resultSeq.value += 1;
}

function onReplace(fresh: TranslateResult): void {
  show(fresh);
  remember(fresh);
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
  show(entry);
  focusInput();
}

// Unsaved and saved must read apart at a glance (two teal tints did not): a filled Save, then a red Remove.
const SAVE_BTN = "btn-primary !min-h-9 min-w-9 gap-1.5 !px-2 !text-sm sm:!px-3";
const SAVED_BTN = "btn-secondary !min-h-9 min-w-9 gap-1.5 !px-2 !text-sm sm:!px-3 !border-danger !text-danger hover:!bg-danger-soft";
// Icon-only on a phone, labelled where there is room: the sparkles say "more about this word".
const EXPLORE_BTN = "btn-secondary !min-h-9 min-w-9 gap-1.5 !px-2 !text-sm";
const explore = ref<InstanceType<typeof CardExplore> | null>(null);
const dictionaries = ref<Dictionary[]>([]);

async function loadDictionaries(): Promise<void> {
  try {
    dictionaries.value = (await api.dictionaries()).items;
  } catch {
    dictionaries.value = []; // the plain Save still works without the list
  }
}

// Every saved word lives in the default list; a chosen other list is added on top, as the bot's "add to" does.
async function save(target?: Dictionary): Promise<void> {
  const current = result.value;
  if (!current?.saveToken || savePending.value) return;
  savePending.value = true;
  errorKey.value = null;
  try {
    const { entryId } = await api.saveTranslation(current.saveToken);
    if (target && !target.isDefault) await api.placeEntry(entryId, target.id);
    current.savedEntryId = entryId;
    saveState.value = "saved";
    markHistory(current, entryId);
    toast(t("web.translate.savedToDictionary"));
  } catch {
    errorKey.value = "web.common.error";
  } finally {
    savePending.value = false;
  }
}

// History holds copies: keep their saved mark in step, or a reopened word shows a stale button.
function markHistory(entry: TranslateResult, entryId: number | null): void {
  const key = historyKey(entry);
  history.value = history.value.map((item) => (historyKey(item) === key ? { ...item, savedEntryId: entryId } : item));
  persistHistory();
}

async function setSaved(saved: boolean): Promise<void> {
  const entryId = result.value?.savedEntryId;
  if (entryId == null || savePending.value) return;
  savePending.value = true;
  errorKey.value = null;
  try {
    await (saved ? api.restoreEntry(entryId) : api.removeEntry(entryId));
    saveState.value = saved ? "saved" : "removed";
    if (result.value) markHistory(result.value, saved ? entryId : null);
    toast(t(saved ? "web.translate.savedToDictionary" : "web.translate.removed"));
  } catch {
    errorKey.value = "web.common.error";
  } finally {
    savePending.value = false;
  }
}



const voiceAvailable = ref(typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia !== undefined);
const recording = ref(false);
const transcribing = ref(false);
let recorder: WavRecording | null = null;

const VOICE_ERRORS: Record<string, string> = {
  feature_locked: "web.voice.locked",
  voice_too_long: "web.voice.tooLong",
};

function voiceLevel(): number {
  return recorder?.level() ?? 0;
}

async function startRecording(): Promise<void> {
  resetNotices();
  try {
    recorder = await startWavRecording();
    recording.value = true;
  } catch {
    errorKey.value = "web.voice.denied";
  }
}

// Same path as the bot's voice message: the transcript goes through the ordinary translation.
// Without `send` the words only land in the box, so the learner can fix a misheard word first.
async function finishRecording(send: boolean): Promise<void> {
  const active = recorder;
  if (!active) return;
  recorder = null;
  recording.value = false;
  transcribing.value = true;
  try {
    const { text: spoken } = await api.transcribe(await active.stop());
    text.value = spoken;
    if (send) await answer(spoken, {});
    else focusInput();
  } catch (error) {
    if (error instanceof ApiError && error.code === "voice_off") voiceAvailable.value = false;
    errorKey.value = (error instanceof ApiError && VOICE_ERRORS[error.code ?? ""]) || "web.voice.failed";
    errorParams.value = { max: error instanceof ApiError ? (error.body.max ?? 0) : 0 };
  } finally {
    transcribing.value = false;
  }
}

onBeforeUnmount(() => recorder?.cancel());

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
  preview.value = null;
  resetNotices();
  try {
    const fresh = await api.translateProgressive(value, choice, (partial) => {
      preview.value = partial;
    });
    show(fresh);
    remember(fresh);
    // Only on success: a failed or clarifying answer keeps the text so the user can retry or edit it.
    text.value = "";
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
      otherLanguage.value = {
        lang: error.body.lang,
        supported: error.body.supported === true,
        text: error.body.text ?? value,
        languages: error.body.languages ?? [],
      };
    } else if (error instanceof ApiError && error.code === "max_languages") {
      errorKey.value = "web.translate.maxLanguages";
      errorParams.value = { max: error.body.limit ?? 0 };
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
    preview.value = null;
    focusInput();
  }
}

onMounted(() => {
  void loadDictionaries();
  history.value = loadHistory();
  // A Learn page hands a phrase over as ?q= (the expression's "to dictionary"), as the bot's notif:tr translates it.
  if (earlyFocused.value) {
    focusInput();
    requestAnimationFrame(() => composer.value?.el?.setSelectionRange(text.value.length, text.value.length));
  }
  const handed = new URLSearchParams(window.location.search).get("q")?.trim();
  if (handed) {
    text.value = handed;
    void submit();
  }
});
</script>

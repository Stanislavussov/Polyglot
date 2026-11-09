<template>
  <section class="space-y-4">
    <a href="/learn/" class="-my-2 inline-flex min-h-11 items-center text-sm text-ink-muted hover:underline">{{ t("web.learn.back") }}</a>
    <h1 class="text-2xl font-bold tracking-tight">🎬 {{ t("web.learn.videos") }}</h1>

    <form class="flex flex-col gap-2 sm:flex-row" @submit.prevent="submit({ url: url.trim() })">
      <label class="sr-only" for="video-url">{{ t("web.learn.videos.urlLabel") }}</label>
      <input id="video-url" v-model="url" class="field" type="url" inputmode="url" :placeholder="t('web.learn.videos.urlLabel')" />
      <button type="submit" class="btn-primary shrink-0" :disabled="busy || url.trim() === ''">{{ t("web.learn.videos.extract") }}</button>
    </form>

    <LimitNotice v-if="limit" :reason="limit.reason" :reset-at="limit.resetAt" />
    <p v-else-if="errorKey" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t(errorKey) }}</p>

    <article v-if="pending" class="card space-y-3">
      <h2 class="font-semibold">{{ pending.video.title }}</h2>
      <p class="text-sm text-ink-muted">
        {{ t("web.learn.videos.duration") }}: {{ duration(pending.video.durationSeconds) }}
        <template v-if="pending.limit !== null"> · {{ t("web.learn.videos.remaining") }}: {{ pending.remaining }}/{{ pending.limit }}</template>
      </p>
      <div class="flex gap-2">
        <button type="button" class="btn-primary" :disabled="busy" @click="confirm">{{ t("web.learn.videos.extract") }}</button>
        <button type="button" class="btn-secondary" :disabled="busy" @click="cancel">{{ t("web.learn.videos.cancel") }}</button>
      </div>
    </article>

    <p v-if="processing" class="card text-sm" role="status">{{ t("web.learn.videos.processing") }}</p>

    <article v-if="open" class="card space-y-3" aria-live="polite">
      <h2 class="font-semibold">
        <a :href="open.video.url" target="_blank" rel="noopener noreferrer" class="hover:underline">{{ open.video.title }}</a>
      </h2>
      <p v-if="open.phrases.length === 0" class="text-sm">{{ t("web.learn.videos.noPhrases") }}</p>
      <ul class="space-y-2">
        <li v-for="phrase in open.phrases" :key="phrase.id" class="flex items-start justify-between gap-3 rounded-xl bg-surface-muted px-4 py-3 text-sm">
          <div class="min-w-0 space-y-1">
            <p class="font-semibold">{{ phrase.emoji }} {{ phrase.phrase }} <span v-if="phrase.nativeTranslation" class="font-normal">— {{ phrase.nativeTranslation }}</span></p>
            <p v-if="phrase.context" class="italic text-ink-muted">{{ phrase.context }}</p>
          </div>
          <button type="button" class="btn-secondary shrink-0" :disabled="phrase.saved" @click="savePhrase(phrase)">
            {{ phrase.saved ? t("web.common.saved") : t("web.common.save") }}
          </button>
        </li>
      </ul>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-secondary" :disabled="open.phrases.every((p) => p.saved)" @click="saveAll">{{ t("web.learn.videos.saveAll") }}</button>
        <template v-if="open.totalPages > 1">
          <button type="button" class="btn-secondary" :disabled="open.page <= 1" @click="openVideo(open.video.id, open.page - 1)">‹</button>
          <span class="text-sm">{{ t("web.learn.videos.page", { page: open.page, total: open.totalPages }) }}</span>
          <button type="button" class="btn-secondary" :disabled="open.page >= open.totalPages" @click="openVideo(open.video.id, open.page + 1)">›</button>
        </template>
      </div>
    </article>

    <section class="space-y-2">
      <h2 class="text-sm font-semibold text-ink-muted">{{ t("web.learn.videos.mine") }}</h2>
      <p v-if="listing && listing.videos.length === 0" class="text-sm">{{ t("web.learn.videos.none") }}</p>
      <ul v-if="listing" class="space-y-1">
        <li v-for="video in listing.videos" :key="video.id" class="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-surface-muted">
          <span class="min-w-0 truncate">{{ statusIcon(video.status) }} {{ video.title }}</span>
          <button v-if="video.status === 'completed'" type="button" class="btn-secondary shrink-0" @click="openVideo(video.id, 1)">
            {{ t("web.learn.videos.open") }}
          </button>
        </li>
      </ul>
      <template v-if="listing && listing.videos.length === 0 && listing.suggestions.length > 0">
        <p class="text-sm">{{ t("web.learn.videos.tryThese") }}</p>
        <ul class="space-y-1">
          <li v-for="suggestion in listing.suggestions" :key="`${suggestion.lang}:${suggestion.index}`">
            <button type="button" class="min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-muted" :disabled="busy" @click="submit({ suggestion })">
              <LangFlag :code="suggestion.lang" /> {{ suggestion.title }}
            </button>
          </li>
        </ul>
      </template>
    </section>
  </section>
</template>

<script setup lang="ts">
import LangFlag from "./LangFlag.vue";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { learnApi, type Video, type VideoPhrase, type VideoSuggestion } from "../lib/learn-api";
import LimitNotice from "./LimitNotice.vue";

const POLL_MS = 3000;

type Listing = Awaited<ReturnType<typeof learnApi.videos>>;
type Opened = Awaited<ReturnType<typeof learnApi.video>>;

const url = ref("");
const busy = ref(false);
const listing = ref<Listing | null>(null);
const pending = ref<{ video: Video; remaining: number | null; limit: number | null } | null>(null);
const processing = ref<number | null>(null);
const open = ref<Opened | null>(null);
const limit = ref<{ reason?: "plan" | "daily_ceiling"; resetAt?: string } | null>(null);
const errorKey = ref<string | null>(null);
let poll: ReturnType<typeof setTimeout> | undefined;

function duration(seconds: number | null): string {
  if (!seconds) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusIcon(status: Video["status"]): string {
  return { completed: "✅", failed: "❌", pending: "⏳", processing: "⏳" }[status];
}

function clearNotices(): void {
  limit.value = null;
  errorKey.value = null;
}

const ERRORS: Record<string, string> = {
  video_limit: "web.learn.videos.limit",
  already_processing: "web.learn.videos.busy",
  metadata_failed: "web.learn.videos.metadataError",
  invalid_url: "web.learn.videos.onlyYouTube",
};

function showError(err: unknown): void {
  if (err instanceof ApiError && err.code === "limit") {
    limit.value = { reason: err.body.reason as "plan" | "daily_ceiling", resetAt: err.body.resetAt };
    return;
  }
  errorKey.value = (err instanceof ApiError && err.code && ERRORS[err.code]) || "web.common.error";
}

async function refresh(): Promise<void> {
  listing.value = await learnApi.videos(1);
}

async function submit(body: { url: string } | { suggestion: VideoSuggestion }): Promise<void> {
  clearNotices();
  busy.value = true;
  try {
    const payload = "url" in body ? body : { suggestion: { lang: body.suggestion.lang, index: body.suggestion.index } };
    const outcome = await learnApi.submitVideo(payload);
    if (outcome.status === "existing") await openVideo(outcome.video.id, 1);
    else pending.value = outcome;
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

async function confirm(): Promise<void> {
  const video = pending.value?.video;
  if (!video) return;
  clearNotices();
  busy.value = true;
  try {
    await learnApi.confirmVideo(video.id);
    pending.value = null;
    url.value = "";
    processing.value = video.id;
    schedulePoll();
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

async function cancel(): Promise<void> {
  const video = pending.value?.video;
  pending.value = null;
  if (video) await learnApi.cancelVideo(video.id).catch(() => undefined);
}

function schedulePoll(): void {
  clearTimeout(poll);
  poll = setTimeout(async () => {
    const id = processing.value;
    if (id === null) return;
    try {
      const state = await learnApi.video(id, 1);
      if (state.video.status === "completed") {
        processing.value = null;
        open.value = state;
        await refresh();
      } else if (state.video.status === "failed") {
        processing.value = null;
        errorKey.value = "web.learn.videos.failed";
        await refresh();
      } else {
        schedulePoll();
      }
    } catch {
      schedulePoll();
    }
  }, POLL_MS);
}

async function openVideo(id: number, page: number): Promise<void> {
  clearNotices();
  try {
    open.value = await learnApi.video(id, page);
  } catch (err) {
    showError(err);
  }
}

async function savePhrase(phrase: VideoPhrase): Promise<void> {
  try {
    await learnApi.saveVideoPhrase(phrase.id);
    phrase.saved = true;
  } catch (err) {
    showError(err);
  }
}

async function saveAll(): Promise<void> {
  const current = open.value;
  if (!current) return;
  try {
    await learnApi.saveAllVideoPhrases(current.video.id);
    for (const phrase of current.phrases) phrase.saved = true;
  } catch (err) {
    showError(err);
  }
}

onMounted(() => {
  refresh().catch(() => {
    errorKey.value = "web.common.error";
  });
});
onBeforeUnmount(() => clearTimeout(poll));
</script>

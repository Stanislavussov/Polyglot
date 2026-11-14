<template>
  <section class="space-y-5">
    <a href="/learn/" class="-my-2 inline-flex min-h-11 items-center text-sm text-ink-muted hover:underline">{{ t("web.learn.back") }}</a>
    <h1 class="page-title">{{ t("web.learn.articles") }}</h1>
    <p class="text-base text-ink-muted">{{ t("web.learn.articles.hint") }}</p>

    <form class="flex flex-col gap-2 sm:flex-row" @submit.prevent="submit">
      <label class="sr-only" for="article-url">{{ t("web.learn.articles.urlLabel") }}</label>
      <input
        id="article-url"
        v-model="url"
        class="field"
        type="url"
        inputmode="url"
        autocomplete="off"
        :placeholder="t('web.learn.articles.urlLabel')"
      />
      <button type="submit" class="btn-primary shrink-0" :disabled="busy || url.trim() === ''">
        <Loader2 v-if="busy && !pending" class="size-4 animate-spin" aria-hidden="true" />
        {{ t("web.learn.articles.read") }}
      </button>
    </form>

    <LimitNotice v-if="limit" :reason="limit.reason" :reset-at="limit.resetAt" />
    <p v-else-if="errorKey" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t(errorKey) }}</p>

    <article v-if="pending" class="card space-y-3">
      <h2 class="text-xl font-semibold">{{ pending.article.title }}</h2>
      <p class="text-sm text-ink-muted">
        <template v-if="pending.article.siteName">{{ pending.article.siteName }} · </template>
        {{ t("web.learn.articles.words", { count: pending.article.wordCount }) }}
      </p>
      <p class="text-base text-ink-muted">{{ pending.excerpt }}</p>
      <p v-if="pending.article.truncated" class="text-sm text-ink-muted">{{ t("web.learn.articles.truncated") }}</p>
      <div class="flex gap-2">
        <button type="button" class="btn-primary" :disabled="busy" @click="confirm">{{ t("web.learn.articles.extract") }}</button>
        <button type="button" class="btn-secondary" :disabled="busy" @click="cancel">{{ t("web.learn.videos.cancel") }}</button>
      </div>
    </article>

    <p v-if="processing" class="card flex items-center gap-2 text-sm" role="status">
      <Loader2 class="size-4 animate-spin" aria-hidden="true" />{{ t("web.learn.articles.processing") }}
    </p>

    <article v-if="open" class="card space-y-3" aria-live="polite">
      <h2 class="text-xl font-semibold">
        <a :href="open.article.url" target="_blank" rel="noopener noreferrer" class="hover:underline">{{ open.article.title }}</a>
      </h2>
      <p v-if="open.phrases.length === 0" class="text-base">{{ t("web.learn.articles.noPhrases") }}</p>
      <ul class="space-y-2">
        <li v-for="phrase in open.phrases" :key="phrase.id" class="flex items-start justify-between gap-3 rounded-xl bg-surface-muted px-4 py-3">
          <div class="min-w-0 space-y-1">
            <p class="text-base font-semibold">
              {{ phrase.emoji }} {{ phrase.phrase }}
              <span v-if="phrase.nativeTranslation" class="font-normal">— {{ phrase.nativeTranslation }}</span>
            </p>
            <p v-if="phrase.context" class="text-sm italic text-ink-muted">{{ phrase.context }}</p>
          </div>
          <button type="button" class="btn-secondary shrink-0" :disabled="phrase.saved" @click="savePhrase(phrase)">
            {{ phrase.saved ? t("web.common.saved") : t("web.common.save") }}
          </button>
        </li>
      </ul>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn-secondary" :disabled="open.phrases.every((p) => p.saved)" @click="saveAll">
          {{ t("web.learn.videos.saveAll") }}
        </button>
        <template v-if="open.totalPages > 1">
          <button type="button" class="btn-secondary" :disabled="open.page <= 1" :aria-label="t('web.dictionary.previous')" @click="openArticle(open.article.id, open.page - 1)">
            <ChevronLeft class="size-4" aria-hidden="true" />
          </button>
          <span class="text-sm">{{ t("web.learn.videos.page", { page: open.page, total: open.totalPages }) }}</span>
          <button type="button" class="btn-secondary" :disabled="open.page >= open.totalPages" :aria-label="t('web.dictionary.next')" @click="openArticle(open.article.id, open.page + 1)">
            <ChevronRight class="size-4" aria-hidden="true" />
          </button>
        </template>
      </div>
    </article>

    <section class="space-y-2">
      <h2 class="text-sm font-semibold text-ink-muted">{{ t("web.learn.articles.mine") }}</h2>
      <p v-if="listing && listing.articles.length === 0" class="text-base">{{ t("web.learn.articles.none") }}</p>
      <ul v-if="listing" class="space-y-1">
        <li
          v-for="article in listing.articles"
          :key="article.id"
          class="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-surface-muted"
        >
          <span class="flex min-w-0 items-center gap-2">
            <Check v-if="article.status === 'completed'" class="size-4 shrink-0 text-primary" aria-hidden="true" />
            <X v-else-if="article.status === 'failed'" class="size-4 shrink-0 text-danger" aria-hidden="true" />
            <Loader2 v-else class="size-4 shrink-0 animate-spin" aria-hidden="true" />
            <span class="truncate">{{ article.title }}</span>
            <span v-if="article.siteName" class="hidden shrink-0 text-ink-muted sm:inline">· {{ article.siteName }}</span>
          </span>
          <button v-if="article.status === 'completed'" type="button" class="btn-secondary shrink-0" @click="openArticle(article.id, 1)">
            {{ t("web.learn.videos.open") }}
          </button>
        </li>
      </ul>
    </section>
  </section>
</template>

<script setup lang="ts">
import { Check, ChevronLeft, ChevronRight, Loader2, X } from "lucide-vue-next";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { type Article, type ArticlePhrase, learnApi } from "../lib/learn-api";
import LimitNotice from "./LimitNotice.vue";

const POLL_MS = 3000;

type Listing = Awaited<ReturnType<typeof learnApi.articles>>;
type Opened = Awaited<ReturnType<typeof learnApi.article>>;

const url = ref("");
const busy = ref(false);
const listing = ref<Listing | null>(null);
const pending = ref<{ article: Article; excerpt: string } | null>(null);
const processing = ref<number | null>(null);
const open = ref<Opened | null>(null);
const limit = ref<{ reason?: "plan" | "daily_ceiling"; resetAt?: string } | null>(null);
const errorKey = ref<string | null>(null);
let poll: ReturnType<typeof setTimeout> | undefined;

const ERRORS: Record<string, string> = {
  already_processing: "web.learn.articles.busy",
  invalid_url: "web.learn.articles.invalidUrl",
  blocked_host: "web.learn.articles.invalidUrl",
  fetch_failed: "web.learn.articles.fetchError",
  not_html: "web.learn.articles.notArticle",
  too_large: "web.learn.articles.notArticle",
  not_an_article: "web.learn.articles.notArticle",
};

function clearNotices(): void {
  limit.value = null;
  errorKey.value = null;
}

function showError(err: unknown): void {
  if (err instanceof ApiError && err.code === "limit") {
    limit.value = { reason: err.body.reason as "plan" | "daily_ceiling", resetAt: err.body.resetAt };
    return;
  }
  errorKey.value = (err instanceof ApiError && err.code && ERRORS[err.code]) || "web.common.error";
}

async function refresh(): Promise<void> {
  listing.value = await learnApi.articles(1);
}

async function submit(): Promise<void> {
  clearNotices();
  open.value = null;
  busy.value = true;
  try {
    const outcome = await learnApi.submitArticle(url.value.trim());
    if (outcome.status === "existing") {
      url.value = "";
      await openArticle(outcome.article.id, 1);
    } else {
      pending.value = outcome;
    }
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

async function confirm(): Promise<void> {
  const article = pending.value?.article;
  if (!article) return;
  clearNotices();
  busy.value = true;
  try {
    await learnApi.confirmArticle(article.id);
    pending.value = null;
    url.value = "";
    processing.value = article.id;
    schedulePoll();
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}

async function cancel(): Promise<void> {
  const article = pending.value?.article;
  pending.value = null;
  if (article) await learnApi.cancelArticle(article.id).catch(() => undefined);
}

function schedulePoll(): void {
  clearTimeout(poll);
  poll = setTimeout(async () => {
    const id = processing.value;
    if (id === null) return;
    try {
      const state = await learnApi.article(id, 1);
      if (state.article.status === "completed") {
        processing.value = null;
        open.value = state;
        await refresh();
      } else if (state.article.status === "failed") {
        processing.value = null;
        errorKey.value = "web.learn.articles.failed";
        await refresh();
      } else {
        schedulePoll();
      }
    } catch {
      schedulePoll();
    }
  }, POLL_MS);
}

async function openArticle(id: number, page: number): Promise<void> {
  clearNotices();
  try {
    open.value = await learnApi.article(id, page);
  } catch (err) {
    showError(err);
  }
}

async function savePhrase(phrase: ArticlePhrase): Promise<void> {
  try {
    await learnApi.saveArticlePhrase(phrase.id);
    phrase.saved = true;
  } catch (err) {
    showError(err);
  }
}

async function saveAll(): Promise<void> {
  const current = open.value;
  if (!current) return;
  try {
    await learnApi.saveAllArticlePhrases(current.article.id);
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

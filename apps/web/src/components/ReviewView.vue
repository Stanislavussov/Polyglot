<template>
  <section>
    <div class="flex items-baseline justify-between gap-3">
      <h1 class="page-title">{{ t("web.review.title") }}</h1>
      <p v-if="state" class="text-sm text-ink-muted">{{ t("web.review.due", { count: state.dueCount }) }}</p>
    </div>

    <div v-if="removed" class="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-muted px-4 py-3 text-sm" role="status">
      <span class="min-w-0 break-words text-ink-muted">{{ t("web.dictionary.removed", { word: removed.word }) }}</span>
      <button type="button" class="btn-secondary" :disabled="busy" @click="undo">
        <Undo2 class="size-4" aria-hidden="true" />{{ t("web.dictionary.undo") }}
      </button>
    </div>

    <p v-if="failed" role="alert" class="mt-6 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>
    <div v-else-if="!state" class="card mt-6"><MonsterLoader :label="t('web.common.loading')" /></div>
    <p v-else-if="!card" class="card mt-6 text-center text-ink-muted">{{ t("web.review.empty") }}</p>

    <article v-else :key="cardSeq" class="card mt-6 space-y-5" aria-live="polite">
      <header class="space-y-3">
        <p v-if="picked" class="text-xs font-semibold uppercase tracking-wide text-primary">{{ t("web.review.picked") }}</p>
        <p v-else-if="card.ahead" class="text-xs font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.review.ahead") }}</p>
        <p class="text-sm text-ink-muted">
          <span aria-hidden="true">{{ languageFlag(card.detail.sourceLang) }}</span> {{ languageName(card.detail.sourceLang) }}
        </p>
        <div class="flex items-start gap-3">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <h2 class="min-w-0 break-words text-3xl font-bold">
              <span v-if="card.detail.emoji" class="mr-2" aria-hidden="true">{{ card.detail.emoji }}</span>{{ card.front.headword }}
            </h2>
            <SpeakButton
              v-if="speaks(card.detail.sourceLang)"
              class="shrink-0"
              :entry-id="card.entryId"
              :lang="card.detail.sourceLang"
              :text="card.front.headword"
              :access="card.audio.access"
              @notice="showNotice"
            />
          </div>
          <PopoverRoot :open="frontOpen" @update:open="setFrontPanel">
            <PopoverTrigger class="btn-secondary shrink-0 !px-3" :aria-label="t('web.review.frontSettings')" :title="t('web.review.frontSettings')">
              <Settings2 class="size-4" aria-hidden="true" />
            </PopoverTrigger>
            <PopoverPortal>
              <!-- A floating panel, not an inline block: opening it must not push the card down. -->
              <PopoverContent
                align="end"
                :side-offset="8"
                :collision-padding="16"
                class="z-30 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-2 shadow-xl"
              >
                <p class="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.review.frontSettings") }}</p>
                <p v-if="!frontFields" class="px-3 py-2 text-sm text-ink-muted">{{ t("web.common.loading") }}</p>
                <label
                  v-for="field in frontFieldKeys"
                  v-else
                  :key="field"
                  class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-base hover:bg-surface-muted"
                >
                  <input
                    type="checkbox"
                    class="size-5 shrink-0 accent-primary"
                    :checked="frontFields[field]"
                    :disabled="frontBusy"
                    @change="setFrontField(field, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="flex-1">{{ t(`web.review.front.${field}`) }}</span>
                  <span v-if="frontFields[field] && !frontHas(field)" class="text-sm text-ink-muted">{{ t("web.review.front.missing") }}</span>
                </label>
              </PopoverContent>
            </PopoverPortal>
          </PopoverRoot>
        </div>
        <ul v-if="card.front.synonyms.length > 0" class="flex flex-wrap gap-2" :aria-label="t('web.translate.synonyms')">
          <li v-for="synonym in card.front.synonyms" :key="synonym" class="rounded-full bg-primary-soft px-3 py-1 text-sm text-primary-soft-fg">
            {{ synonym }}
          </li>
        </ul>
        <p v-if="card.front.hint" class="text-base italic text-ink-muted">🔎 {{ card.front.hint }}</p>
        <p v-if="card.front.example" class="border-l-2 border-line pl-3 text-base font-medium">{{ card.front.example }}</p>
      </header>

      <p v-if="notice" role="status" class="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-fg">{{ t(notice) }}</p>

      <template v-if="revealed">
        <TranslationBlock v-for="translation in split.native ? [split.native] : []" :key="translation.lang" :translation="translation" id-prefix="review">
          <template #actions>
            <SpeakButton
              v-if="speaks(translation.lang)"
              :entry-id="card.entryId"
              :lang="translation.lang"
              :text="translation.text"
              :access="card.audio.access"
              @notice="showNotice"
            />
          </template>
        </TranslationBlock>

        <div class="space-y-3 rounded-2xl bg-primary-soft p-4 text-center">
          <p class="text-base font-semibold text-primary-soft-fg">{{ t("web.review.how") }}</p>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              v-for="rating in ratings"
              :key="rating.value"
              type="button"
              :class="rating.value === 'again' ? 'btn-secondary !text-danger' : 'btn-secondary'"
              :disabled="busy"
              @click="rate(rating.value)"
            >
              {{ t(rating.label) }}
            </button>
          </div>
        </div>

        <p v-if="card.detail.nativeMeaning" class="border-t border-line pt-4 text-base">
          <span class="font-semibold text-ink-muted">{{ t("web.translate.nativeMeaning") }}:</span>
          {{ card.detail.nativeMeaning }}
        </p>

        <div v-if="card.detail.sourceUsage" class="space-y-2 rounded-xl bg-surface-muted px-4 py-3 text-sm">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">{{ t("web.translate.aboutSource") }}</h3>
          <p>{{ card.detail.sourceUsage.explanation }}</p>
          <ul v-if="card.front.synonyms.length === 0 && card.detail.sourceUsage.synonyms.length > 0" class="flex flex-wrap gap-2">
            <li v-for="synonym in card.detail.sourceUsage.synonyms" :key="synonym" class="rounded-full bg-primary-soft px-3 py-1 text-primary-soft-fg">
              {{ synonym }}
            </li>
          </ul>
          <ExampleList :examples="card.detail.sourceUsage.examples" />
        </div>

        <TranslationBlock v-for="translation in split.others" :key="translation.lang" :translation="translation" id-prefix="review">
          <template #actions>
            <SpeakButton
              v-if="speaks(translation.lang)"
              :entry-id="card.entryId"
              :lang="translation.lang"
              :text="translation.text"
              :access="card.audio.access"
              @notice="showNotice"
            />
          </template>
        </TranslationBlock>

      </template>
      <div v-else class="text-center">
        <button type="button" class="btn-primary w-full sm:w-auto" @click="revealed = true">
          {{ t("web.review.reveal") }}
          <span class="btn-chip" aria-hidden="true"><Eye class="size-4" /></span>
        </button>
      </div>

      <div class="border-t border-line pt-4 text-center">
        <button type="button" class="btn-secondary !text-danger" :disabled="busy" @click="remove">
          <Trash2 class="size-4" aria-hidden="true" />{{ t("web.dictionary.remove") }}
        </button>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { Eye, Settings2, Trash2, Undo2 } from "lucide-vue-next";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { computed, onMounted, ref } from "vue";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import { splitNative } from "../lib/card-order";
import { languageFlag, languageName, settings } from "../lib/settings-store";
import type { CardFrontFields, Rating, ReviewState } from "../lib/types";
import ExampleList from "./ExampleList.vue";
import MonsterLoader from "./MonsterLoader.vue";
import SpeakButton from "./SpeakButton.vue";
import TranslationBlock from "./TranslationBlock.vue";

const ratings = [
  { value: "again", label: "web.review.again" },
  { value: "hard", label: "web.review.hard" },
  { value: "good", label: "web.review.good" },
  { value: "easy", label: "web.review.easy" },
] as const satisfies readonly { value: Rating; label: string }[];

const state = ref<ReviewState | null>(null);
const card = computed(() => state.value?.card ?? null);
const split = computed(() => splitNative(card.value?.detail.details ?? [], settings.value?.nativeLang));
// Bumped per card so the next card opens folded, with fresh speaker buttons.
const cardSeq = ref(0);
const revealed = ref(false);
const busy = ref(false);
const failed = ref(false);
const picked = ref(false);
const notice = ref<string | null>(null);
// The bot's fc:del / fc:undo: the word leaves the dictionary, the deck goes on, one tap brings it back.
const removed = ref<{ entryId: number; word: string } | null>(null);

// The bot's card-settings toggles, on the card itself: a change redraws this card's front in place.
const frontFieldKeys = ["hint", "synonyms", "example"] as const satisfies readonly (keyof CardFrontFields)[];
const frontOpen = ref(false);
const frontFields = ref<CardFrontFields | null>(null);
const frontBusy = ref(false);

// An enabled field the word has no data for changes nothing on the card; say so instead of looking broken.
function frontHas(field: keyof CardFrontFields): boolean {
  const front = card.value?.front;
  if (!front) return false;
  return field === "synonyms" ? front.synonyms.length > 0 : Boolean(front[field]);
}

async function setFrontPanel(open: boolean): Promise<void> {
  frontOpen.value = open;
  if (!open || frontFields.value) return;
  try {
    frontFields.value = await api.cardFront();
  } catch {
    frontOpen.value = false;
    notice.value = "web.common.error";
  }
}

async function setFrontField(field: keyof CardFrontFields, enabled: boolean): Promise<void> {
  const current = card.value;
  if (!current || frontBusy.value) return;
  frontBusy.value = true;
  try {
    frontFields.value = await api.setCardFront(field, enabled);
    // Swap only the card data: the reveal and the open panel stay as the learner left them.
    const fresh = await api.reviewCard(current.entryId);
    // A single-card fetch never carries `ahead`; keep the label so the card does not jump.
    if (fresh.card?.entryId === current.entryId) state.value = { ...fresh, card: { ...fresh.card, ahead: current.ahead } };
  } catch {
    notice.value = "web.common.error";
  } finally {
    frontBusy.value = false;
  }
}

function speaks(lang: string): boolean {
  const audio = card.value?.audio;
  return audio != null && audio.access !== "off" && audio.langs.includes(lang);
}

function showNotice(key: string): void {
  notice.value = key;
}

async function show(next: Promise<ReviewState>): Promise<void> {
  failed.value = false;
  try {
    state.value = await next;
    revealed.value = false;
    notice.value = null;
    cardSeq.value += 1;
  } catch {
    failed.value = true;
  }
}

async function rate(rating: Rating): Promise<void> {
  const current = card.value;
  if (!current || busy.value) return;
  busy.value = true;
  picked.value = false;
  removed.value = null;
  try {
    await show(
      api.rate(current.entryId, rating).catch((error: unknown) => {
        // The word was deleted elsewhere (e.g. in the bot): skip to the next card instead of failing.
        if (error instanceof ApiError && error.status === 404) return api.reviewNext();
        throw error;
      }),
    );
  } finally {
    busy.value = false;
  }
}

async function remove(): Promise<void> {
  const current = card.value;
  if (!current || busy.value) return;
  busy.value = true;
  picked.value = false;
  try {
    // A 404 means it was already removed elsewhere: it leaves the deck, with nothing to undo.
    const wasRemoved = await api.removeEntry(current.entryId).then(
      () => true,
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return false;
        throw error;
      },
    );
    removed.value = wasRemoved ? { entryId: current.entryId, word: current.front.headword } : null;
    await show(api.reviewNext());
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}

async function undo(): Promise<void> {
  const last = removed.value;
  if (!last || busy.value) return;
  busy.value = true;
  try {
    await api.restoreEntry(last.entryId);
    removed.value = null;
    await show(api.reviewCard(last.entryId));
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}

// "Review this word" from the dictionary opens with that card; a deleted or unreviewable word falls back to the deck.
function requestedCard(): Promise<ReviewState> {
  const entryId = Number(new URLSearchParams(window.location.search).get("entry"));
  if (!Number.isInteger(entryId) || entryId <= 0) return api.reviewNext();
  return api.reviewCard(entryId).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return api.reviewNext();
    throw error;
  });
}

onMounted(async () => {
  const requested = new URLSearchParams(window.location.search).has("entry");
  await show(requestedCard());
  // Only the first card is the picked word; the card after a rating is the normal deck.
  picked.value = requested && card.value != null;
});
</script>

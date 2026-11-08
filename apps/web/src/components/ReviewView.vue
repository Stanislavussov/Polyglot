<template>
  <section>
    <div class="flex items-baseline justify-between gap-3">
      <h1 class="text-2xl font-bold tracking-tight">{{ t("web.review.title") }}</h1>
      <p v-if="state" class="text-sm text-ink-muted">{{ t("web.review.due", { count: state.dueCount }) }}</p>
    </div>

    <p v-if="failed" role="alert" class="mt-6 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>
    <p v-else-if="!state" class="mt-6 text-sm text-ink-muted" role="status">{{ t("web.common.loading") }}</p>
    <p v-else-if="!state.card" class="card mt-6 text-center text-ink-muted">{{ t("web.review.empty") }}</p>

    <article v-else class="card mt-6 text-center" aria-live="polite">
      <p v-if="picked" class="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">{{ t("web.review.picked") }}</p>
      <p class="text-sm text-ink-muted">{{ languageFlag(state.card.sourceLang) }} {{ languageName(state.card.sourceLang) }}</p>
      <p class="mt-3 break-words text-3xl font-bold">
        <span v-if="state.card.emoji" class="mr-2" aria-hidden="true">{{ state.card.emoji }}</span>{{ state.card.original }}
      </p>

      <div v-if="revealed" class="mt-6 space-y-2 border-t border-line pt-6">
        <p v-for="line in state.card.back" :key="line.lang" class="text-xl font-semibold text-primary">
          <span class="text-base text-ink-muted">{{ languageFlag(line.lang) }}</span> {{ line.text }}
        </p>
        <p class="pt-4 text-sm text-ink-muted">{{ t("web.review.how") }}</p>
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
      <button v-else type="button" class="btn-primary mt-8 w-full sm:w-auto" @click="revealed = true">
        {{ t("web.review.reveal") }}
      </button>
    </article>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import { languageFlag, languageName } from "../lib/settings-store";
import type { Rating, ReviewState } from "../lib/types";

const ratings = [
  { value: "again", label: "web.review.again" },
  { value: "hard", label: "web.review.hard" },
  { value: "good", label: "web.review.good" },
  { value: "easy", label: "web.review.easy" },
] as const satisfies readonly { value: Rating; label: string }[];

const state = ref<ReviewState | null>(null);
const revealed = ref(false);
const busy = ref(false);
const failed = ref(false);
const picked = ref(false);

async function show(next: Promise<ReviewState>): Promise<void> {
  failed.value = false;
  try {
    state.value = await next;
    revealed.value = false;
  } catch {
    failed.value = true;
  }
}

async function rate(rating: Rating): Promise<void> {
  const card = state.value?.card;
  if (!card || busy.value) return;
  busy.value = true;
  picked.value = false;
  try {
    await show(
      api.rate(card.entryId, rating).catch((error: unknown) => {
        // The word was deleted elsewhere (e.g. in the bot): skip to the next card instead of failing.
        if (error instanceof ApiError && error.status === 404) return api.reviewNext();
        throw error;
      }),
    );
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
  picked.value = requested && state.value?.card != null;
});
</script>

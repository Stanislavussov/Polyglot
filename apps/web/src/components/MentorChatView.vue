<template>
  <section class="space-y-4">
    <a href="/learn/" class="-my-2 inline-flex min-h-11 items-center text-sm text-ink-muted hover:underline">{{ t("web.learn.back") }}</a>
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-2xl font-bold tracking-tight">{{ t("web.learn.mentor") }}</h1>
      <button type="button" class="btn-secondary" :disabled="busy || current.turns.length === 0" @click="startNew">
        {{ t("web.learn.mentor.newTopic") }}
      </button>
    </div>

    <p v-if="current.turns.length === 0" class="card text-base">{{ t("web.learn.mentor.intro") }}</p>
    <MentorTurns :turns="current.turns" :busy="busy" />

    <!-- A chat reads top to bottom, so the question box follows the conversation instead of the page top. -->
    <div ref="composer">
      <ComposerCard
        id="mentor-question"
        v-model="question"
        :placeholder="t('web.explore.questionPlaceholder')"
        :submit-label="t('web.explore.send')"
        :max-length="MAX_QUESTION"
        :busy="busy"
        @submit="ask"
      >
        <template #notice>
          <MentorNotice :locked-hint="lockedHint" :limit="limit" :error-text="errorText" />
        </template>
      </ComposerCard>
    </div>

    <MentorTopics v-if="earlier.length > 0" class="border-t border-line pt-4" :threads="earlier" @open="resume" />
  </section>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue";
import { t } from "../lib/i18n";
import { MAX_MENTOR_QUESTION as MAX_QUESTION, useMentorChat } from "../lib/use-mentor-chat";
import ComposerCard from "./ComposerCard.vue";
import MentorNotice from "./MentorNotice.vue";
import MentorTopics from "./MentorTopics.vue";
import MentorTurns from "./MentorTurns.vue";

const { current, earlier, busy, lockedHint, limit, errorText, ask: askMentor, startNew, resume } = useMentorChat();
const question = ref("");
const composer = ref<HTMLElement | null>(null);

async function ask(): Promise<void> {
  if (!(await askMentor(question.value))) return;
  question.value = "";
  await nextTick();
  composer.value?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
</script>

<template>
  <section class="mx-auto max-w-xl">
    <h1 class="text-2xl font-bold tracking-tight">{{ t("web.welcome.title") }}</h1>
    <p v-if="failed" role="alert" class="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>

    <div v-if="step === 'native' && settings" class="card mt-6 space-y-4">
      <p class="font-medium">{{ t("web.welcome.native") }}</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="language in settings.languages"
          :key="language.code"
          type="button"
          class="btn-secondary"
          :disabled="busy"
          @click="chooseNative(language.code)"
        >
          <LangFlag :code="language.code" />{{ language.name }}
        </button>
      </div>
    </div>

    <div v-else-if="step === 'languages' && settings" class="card mt-6 space-y-4">
      <p class="font-medium">{{ t("web.welcome.learning") }}</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="language in settings.languages.filter((l) => l.code !== settings?.nativeLang)"
          :key="language.code"
          type="button"
          :aria-pressed="learning.includes(language.code)"
          :class="learning.includes(language.code) ? 'btn-primary' : 'btn-secondary'"
          @click="toggle(language.code)"
        >
          <LangFlag :code="language.code" />{{ language.name }}
        </button>
      </div>
      <p v-if="tooMany" role="alert" class="text-sm text-danger">{{ t("web.translate.maxLanguages", { max: MAX_LEARNING }) }}</p>
      <button type="button" class="btn-primary" :disabled="busy || learning.length === 0" @click="saveLearning">
        {{ t("web.welcome.next") }}
      </button>
    </div>

    <div v-else-if="step === 'demo'" class="card mt-6 space-y-4">
      <p class="font-medium">{{ t("web.welcome.demo") }}</p>
      <div class="flex flex-wrap gap-2">
        <button v-for="word in hookWords" :key="word" type="button" class="btn-secondary" :disabled="busy" @click="tryWord(word)">
          {{ word }}
        </button>
      </div>
      <p v-if="busy" class="text-sm text-ink-muted" role="status">{{ t("web.translate.loading") }}</p>
      <div v-if="demo" class="space-y-2 border-t border-line pt-4" aria-live="polite">
        <p class="text-xl font-bold">{{ demo.original }}</p>
        <p v-for="translation in demo.translations" :key="translation.lang" class="text-sm">
          <LangFlag :code="translation.lang" /> {{ translation.text }}
        </p>
      </div>
      <button type="button" :class="demo ? 'btn-primary' : 'btn-secondary'" :disabled="busy" @click="finish">
        {{ t("web.welcome.finish") }}
      </button>
    </div>

    <div v-else-if="step === 'done'" class="card mt-6 space-y-4">
      <p>{{ t("web.welcome.done") }}</p>
      <p v-if="trial" class="rounded-xl bg-primary-soft px-4 py-3 text-sm text-primary-soft-fg">{{ t("web.welcome.trial", trial) }}</p>
      <a href="/translate/" class="btn-primary">{{ t("web.welcome.start") }}</a>
    </div>
  </section>
</template>

<script setup lang="ts">
import LangFlag from "./LangFlag.vue";
import { onMounted, ref } from "vue";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { saveSettings, settings } from "../lib/settings-store";
import type { TranslateResult } from "../lib/types";

// Mirrors core MAX_LEARNING_LANGS; the server enforces it.
const MAX_LEARNING = 4;

const step = ref<"native" | "languages" | "demo" | "done">("native");
const learning = ref<string[]>([]);
const tooMany = ref(false);
const busy = ref(false);
const failed = ref(false);
const hookWords = ref<string[]>([]);
const demo = ref<TranslateResult | null>(null);
const trial = ref<{ days: number; words: number; extraDays: number } | null>(null);

const interfaceFor = (code: string): string =>
  settings.value?.interfaceLanguages.includes(code) ? code : (settings.value?.interfaceLang ?? "en");

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true;
  failed.value = false;
  try {
    await action();
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}

function chooseNative(code: string): void {
  // The bot derives the interface language from the native one; the web does the same.
  void run(async () => {
    await saveSettings({ nativeLang: code, interfaceLang: interfaceFor(code) });
    learning.value = (settings.value?.learningLangs ?? []).filter((l) => l !== code);
    await api.onboardingStep("languages");
    step.value = "languages";
  });
}

function toggle(code: string): void {
  tooMany.value = false;
  if (learning.value.includes(code)) learning.value = learning.value.filter((l) => l !== code);
  else if (learning.value.length >= MAX_LEARNING) tooMany.value = true;
  else learning.value = [...learning.value, code];
}

function saveLearning(): void {
  void run(async () => {
    await saveSettings({ learningLangs: learning.value });
    await api.onboardingStep("demo");
    const status = await api.onboarding();
    hookWords.value = Object.values(status.hookWords).flat();
    step.value = "demo";
  });
}

function tryWord(word: string): void {
  void run(async () => {
    demo.value = await api.translate(word);
  });
}

function finish(): void {
  void run(async () => {
    trial.value = (await api.completeOnboarding()).trial;
    step.value = "done";
  });
}

onMounted(() => {
  void api.onboardingStep("native").catch(() => undefined);
});
</script>

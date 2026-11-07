<template>
  <section>
    <h1 class="text-2xl font-bold tracking-tight">{{ t("web.settings.title") }}</h1>

    <form v-if="settings" class="card mt-6 space-y-6" @submit.prevent="submit">
      <div>
        <label class="mb-1 block text-sm font-medium" for="interface-lang">{{ t("web.settings.interfaceLang") }}</label>
        <select id="interface-lang" v-model="interfaceLang" class="field">
          <option v-for="code in settings.interfaceLanguages" :key="code" :value="code">{{ label(code) }}</option>
        </select>
      </div>

      <div>
        <label class="mb-1 block text-sm font-medium" for="native-lang">{{ t("web.settings.nativeLang") }}</label>
        <select id="native-lang" v-model="nativeLang" class="field">
          <option v-for="language in settings.languages" :key="language.code" :value="language.code">
            {{ language.flag }} {{ language.name }}
          </option>
        </select>
      </div>

      <fieldset>
        <legend class="mb-1 text-sm font-medium">{{ t("web.settings.learningLangs") }}</legend>
        <p class="mb-2 text-xs text-ink-muted">{{ t("web.settings.learningHint") }}</p>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label
            v-for="language in settings.languages"
            :key="language.code"
            class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
          >
            <input v-model="learningLangs" type="checkbox" class="size-4 accent-primary" :value="language.code" />
            {{ language.flag }} {{ language.name }}
          </label>
        </div>
      </fieldset>

      <p v-if="failed" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>
      <div class="flex items-center gap-3">
        <button type="submit" class="btn-primary" :disabled="saving || learningLangs.length === 0">{{ t("web.common.save") }}</button>
        <span v-if="saved" role="status" class="text-sm text-primary-soft-fg">{{ t("web.common.saved") }}</span>
      </div>
    </form>
    <p v-else class="mt-6 text-sm text-ink-muted" role="alert">{{ t("web.common.error") }}</p>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { t } from "../lib/i18n";
import { languageFlag, languageName, saveSettings, settings } from "../lib/settings-store";

const interfaceLang = ref(settings.value?.interfaceLang ?? "en");
const nativeLang = ref(settings.value?.nativeLang ?? "en");
const learningLangs = ref<string[]>([...(settings.value?.learningLangs ?? [])]);
const saving = ref(false);
const saved = ref(false);
const failed = ref(false);

function label(code: string): string {
  return `${languageFlag(code)} ${languageName(code)}`.trim();
}

async function submit(): Promise<void> {
  saving.value = true;
  saved.value = false;
  failed.value = false;
  try {
    await saveSettings({
      interfaceLang: interfaceLang.value,
      nativeLang: nativeLang.value,
      learningLangs: learningLangs.value,
    });
    saved.value = true;
  } catch {
    failed.value = true;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section>
    <h1 class="page-title">{{ t("web.settings.title") }}</h1>

    <form v-if="settings" class="card mt-6 space-y-6" @submit.prevent="submit">
      <div>
        <label class="mb-1 block text-sm font-medium" for="interface-lang">{{ t("web.settings.interfaceLang") }}</label>
        <AppSelect
          id="interface-lang"
          v-model="interfaceLang"
          :options="settings.interfaceLanguages.map((code) => ({ value: code, label: label(code), lang: code }))"
        />
      </div>

      <div>
        <label class="mb-1 block text-sm font-medium" for="native-lang">{{ t("web.settings.nativeLang") }}</label>
        <AppSelect
          id="native-lang"
          v-model="nativeLang"
          :options="settings.languages.map((language) => ({ value: language.code, label: language.name, lang: language.code }))"
        />
      </div>

      <fieldset>
        <legend class="mb-1 text-sm font-medium">{{ t("web.settings.learningLangs") }}</legend>
        <p class="mb-2 text-sm text-ink-muted">{{ t("web.settings.learningHint") }}</p>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label
            v-for="language in learnable"
            :key="language.code"
            class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
          >
            <input v-model="learningLangs" type="checkbox" class="size-5 shrink-0 accent-primary" :value="language.code" />
            <LangFlag :code="language.code" />{{ language.name }}
          </label>
        </div>
      </fieldset>

      <p v-if="failed" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ failed }}</p>
      <div class="flex items-center gap-3">
        <button type="submit" class="btn-primary" :disabled="saving || learningLangs.length === 0">{{ t("web.common.save") }}</button>
        <span v-if="saved" role="status" class="text-sm text-primary-soft-fg">{{ t("web.common.saved") }}</span>
      </div>
    </form>
    <p v-else class="mt-6 text-sm text-ink-muted" role="alert">{{ t("web.common.error") }}</p>

    <template v-if="settings">
      <NotificationSettings />
      <TemplateEditor />
      <ReportIssue />
      <ChangesList />
    </template>
  </section>
</template>

<script setup lang="ts">
import AppSelect from "./AppSelect.vue";
import LangFlag from "./LangFlag.vue";
import { computed, ref, watch } from "vue";
import { ApiError } from "../lib/api";
import { MAX_LEARNING_LANGS } from "../lib/learning-langs";
import { t } from "../lib/i18n";
import { languageName, saveSettings, settings } from "../lib/settings-store";
import ChangesList from "./ChangesList.vue";
import NotificationSettings from "./NotificationSettings.vue";
import ReportIssue from "./ReportIssue.vue";
import TemplateEditor from "./TemplateEditor.vue";

const interfaceLang = ref(settings.value?.interfaceLang ?? "en");
const nativeLang = ref(settings.value?.nativeLang ?? "en");
const learningLangs = ref<string[]>([...(settings.value?.learningLangs ?? [])]);
// The server refuses a native language that is also learned (learning_is_native).
const learnable = computed(() => (settings.value?.languages ?? []).filter((language) => language.code !== nativeLang.value));
watch(nativeLang, (code) => {
  learningLangs.value = learningLangs.value.filter((learning) => learning !== code);
});
const saving = ref(false);
const saved = ref(false);
const failed = ref<string | null>(null);

function label(code: string): string {
  return languageName(code);
}

const REJECTIONS = new Set([
  "unknown_interface_lang",
  "unknown_native_lang",
  "unknown_learning_lang",
  "learning_is_native",
  "no_learning_langs",
  "too_many_learning_langs",
]);

// The server names why it refused (invalid_settings + reason); say that, not a bare "something went wrong".
function saveError(error: unknown): string {
  const reason = error instanceof ApiError && error.code === "invalid_settings" ? error.body.reason : undefined;
  return reason && REJECTIONS.has(reason)
    ? t(`web.settings.invalid.${reason}`, { max: MAX_LEARNING_LANGS })
    : t("web.common.error");
}

async function submit(): Promise<void> {
  saving.value = true;
  saved.value = false;
  failed.value = null;
  try {
    await saveSettings({
      interfaceLang: interfaceLang.value,
      nativeLang: nativeLang.value,
      learningLangs: learningLangs.value,
    });
    saved.value = true;
  } catch (error) {
    failed.value = saveError(error);
  } finally {
    saving.value = false;
  }
}
</script>

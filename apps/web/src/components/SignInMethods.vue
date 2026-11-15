<template>
  <section v-if="methods" class="card mt-6 space-y-4" aria-labelledby="methods-title">
    <div>
      <h2 id="methods-title" class="text-xl font-semibold">{{ t("web.methods.title") }}</h2>
      <p class="mt-1 text-sm text-ink-muted">{{ t("web.methods.hint") }}</p>
    </div>

    <ul class="space-y-3">
      <li class="flex min-h-11 items-center justify-between gap-3">
        <span class="text-base">Telegram</span>
        <span v-if="methods.includes('telegram')" class="text-sm text-ink-muted">{{ t("web.methods.connected") }}</span>
        <button v-else type="button" class="btn-secondary" :disabled="botId === null" @click="connectTelegram">
          {{ t("web.methods.connect") }}
        </button>
      </li>
      <li v-if="googleClientId" class="flex min-h-11 items-center justify-between gap-3">
        <span class="text-base">Google</span>
        <span v-if="methods.includes('google')" class="text-sm text-ink-muted">{{ t("web.methods.connected") }}</span>
        <div v-else ref="googleSlot" class="h-11 w-60"></div>
      </li>
    </ul>

    <p v-if="error" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { ApiError, api } from "../lib/api";
import { lang, t } from "../lib/i18n";
import { loadTelegramWidget, openTelegramLogin, renderGoogleButton } from "../lib/sign-in-widgets";

const methods = ref<string[] | null>(null);
const botId = ref<number | null>(null);
const googleClientId = ref<string | null>(null);
const googleSlot = ref<HTMLElement | null>(null);
const error = ref<string | null>(null);

// "taken": that Telegram or Google already has its own account. We never merge two accounts.
async function link(call: () => Promise<{ methods: string[] }>): Promise<void> {
  error.value = null;
  try {
    methods.value = (await call()).methods;
  } catch (failure) {
    const code = failure instanceof ApiError ? failure.status : 0;
    error.value = t(code === 409 ? "web.methods.taken" : "web.common.error");
  }
}

function connectTelegram(): void {
  if (botId.value === null || !openTelegramLogin(botId.value, (user) => void link(() => api.linkTelegram(user)))) {
    error.value = t("web.common.error");
  }
}

onMounted(async () => {
  try {
    const [config, current] = await Promise.all([api.authConfig(), api.signInMethods()]);
    methods.value = current.methods;
    googleClientId.value = config.googleClientId;
    if (!current.methods.includes("telegram") && !config.devLogin) {
      await loadTelegramWidget();
      botId.value = config.botId;
    }
    await nextTick();
    if (googleSlot.value && config.googleClientId) {
      await renderGoogleButton(googleSlot.value, config.googleClientId, lang.value, (credential) => {
        void link(() => api.linkGoogle(credential));
      });
    }
  } catch {
    error.value = t("web.common.error");
  }
});
</script>

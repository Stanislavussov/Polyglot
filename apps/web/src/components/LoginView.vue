<template>
  <main class="grid min-h-screen place-items-center px-4 py-10">
    <div class="card w-full max-w-md text-center">
      <h1 class="text-2xl font-bold tracking-tight">{{ t("web.login.title") }}</h1>
      <p class="mt-2 text-sm text-ink-muted">{{ t("web.login.subtitle") }}</p>
      <button
        v-if="!devLogin"
        type="button"
        class="btn-primary mt-6 w-full"
        :disabled="botId === null"
        @click="openTelegramLogin"
      >
        {{ t("web.login.button") }}
      </button>
      <!-- Fixed height: Google's button arrives after its script loads, and nothing may jump. -->
      <div v-if="!devLogin && googleClientId" ref="googleSlot" class="mt-3 flex h-11 w-full justify-center"></div>
      <button v-if="devLogin" type="button" class="btn-primary mt-6 w-full" @click="signInDev">Dev login</button>
      <p v-if="failed" role="alert" class="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
        {{ t("web.login.failed") }}
      </p>
    </div>
  </main>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { api } from "../lib/api";
import { lang, setLang, t } from "../lib/i18n";
import { loadTelegramWidget, openTelegramLogin as openWidget, renderGoogleButton } from "../lib/sign-in-widgets";

const botId = ref<number | null>(null);
const googleClientId = ref<string | null>(null);
const googleSlot = ref<HTMLElement | null>(null);
const failed = ref(false);
const devLogin = ref(false);

async function enter(login: () => Promise<{ interfaceLang: string }>): Promise<void> {
  failed.value = false;
  try {
    const me = await login();
    await setLang(me.interfaceLang);
    window.location.replace("/translate/");
  } catch {
    failed.value = true;
  }
}

function openTelegramLogin(): void {
  if (botId.value === null || !openWidget(botId.value, (user) => void enter(() => api.loginWithTelegram(user)))) {
    failed.value = true;
  }
}

async function signInDev(): Promise<void> {
  await enter(() => api.devLogin());
}

onMounted(async () => {
  // An open session skips the login; the lookup is silent on 401 because this is the login page.
  const existing = await api.me().catch(() => null);
  if (existing) {
    window.location.replace("/translate/");
    return;
  }
  await setLang(navigator.language.slice(0, 2));
  try {
    const config = await api.authConfig();
    devLogin.value = config.devLogin;
    // A local run cannot use Telegram (it refuses localhost as a bot domain), so dev login replaces it.
    if (config.devLogin) return;
    googleClientId.value = config.googleClientId;
    await loadTelegramWidget();
    botId.value = config.botId;
    await nextTick();
    if (googleSlot.value && config.googleClientId) {
      await renderGoogleButton(googleSlot.value, config.googleClientId, lang.value, (credential) => {
        void enter(() => api.loginWithGoogle(credential));
      });
    }
  } catch {
    failed.value = true;
  }
});
</script>

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
      <button v-if="devLogin" type="button" class="btn-primary mt-6 w-full" @click="signInDev">Dev login</button>
      <p v-if="failed" role="alert" class="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
        {{ t("web.login.failed") }}
      </p>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../lib/api";
import { setLang, t } from "../lib/i18n";

const WIDGET_SRC = "https://telegram.org/js/telegram-widget.js?22";

const botId = ref<number | null>(null);
const failed = ref(false);
const devLogin = ref(false);

async function onAuth(user: TelegramLoginUser): Promise<void> {
  failed.value = false;
  try {
    const me = await api.loginWithTelegram(user);
    await setLang(me.interfaceLang);
    window.location.replace("/translate/");
  } catch {
    failed.value = true;
  }
}

// Telegram.Login.auth instead of the embedded widget: the widget runs its
// data-onauth attribute through eval, which our CSP (no 'unsafe-eval') blocks.
function openTelegramLogin(): void {
  if (botId.value === null || !window.Telegram) {
    failed.value = true;
    return;
  }
  window.Telegram.Login.auth({ bot_id: botId.value, request_access: "write" }, (user) => {
    if (user) void onAuth(user);
  });
}

async function signInDev(): Promise<void> {
  try {
    const me = await api.devLogin();
    await setLang(me.interfaceLang);
    window.location.replace("/translate/");
  } catch {
    failed.value = true;
  }
}

function loadWidgetScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = WIDGET_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("telegram widget script failed to load"));
    document.head.appendChild(script);
  });
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
    await loadWidgetScript();
    botId.value = config.botId;
  } catch {
    failed.value = true;
  }
});
</script>

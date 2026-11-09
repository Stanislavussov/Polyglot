<template>
  <section v-if="notif" class="card mt-6 space-y-6" aria-labelledby="notif-title">
    <div>
      <h2 id="notif-title" class="text-lg font-semibold">{{ t("web.notif.title") }}</h2>
      <p class="mt-1 text-sm text-ink-muted">{{ t("web.notif.hint") }}</p>
    </div>

    <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
      <input type="checkbox" class="size-5 accent-primary" :checked="notif.enabled" :disabled="saving" @change="save({ enabled: !notif.enabled })" />
      {{ t("web.notif.enabled") }}
    </label>

    <template v-if="notif.enabled">
      <fieldset v-if="notif.pushPublicKey">
        <legend class="mb-2 text-sm font-medium">{{ t("web.notif.channel") }}</legend>
        <div class="grid grid-cols-2 gap-2 sm:max-w-sm">
          <button
            v-for="channel in CHANNELS"
            :key="channel"
            type="button"
            :aria-pressed="notif.channel === channel"
            :disabled="saving || (channel === 'web' && !appCanNotify)"
            class="min-h-11 rounded-xl border border-line px-3 text-sm aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-soft-fg disabled:opacity-50"
            @click="chooseChannel(channel)"
          >
            {{ t(`web.notif.channel.${channel}`) }}
          </button>
        </div>
        <p v-if="!appCanNotify" class="mt-2 text-xs text-ink-muted">{{ t("web.notif.channelInstallHint") }}</p>
        <p v-else-if="permissionDenied" class="mt-2 text-xs text-ink-muted">{{ t("web.notif.channelDenied") }}</p>
      </fieldset>

      <fieldset>
        <legend class="mb-1 text-sm font-medium">{{ t("web.notif.times") }}</legend>
        <p class="mb-2 text-xs text-ink-muted">{{ t("web.notif.timesHint", { max: notif.options.maxTimes }) }}</p>
        <div class="grid grid-cols-4 gap-2 sm:grid-cols-8">
          <button
            v-for="slot in SLOTS"
            :key="slot"
            type="button"
            :aria-pressed="notif.times.includes(slot)"
            :disabled="saving || !canToggle(slot)"
            class="min-h-11 rounded-xl border border-line px-2 text-sm tabular-nums aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-soft-fg disabled:opacity-50"
            @click="toggleTime(slot)"
          >
            {{ slot }}
          </button>
        </div>
      </fieldset>

      <div>
        <label class="mb-1 block text-sm font-medium" for="notif-type">{{ t("web.notif.type") }}</label>
        <AppSelect id="notif-type" :model-value="notif.type" :options="typeOptions" :disabled="saving" @update:model-value="(value) => save({ type: value as NotificationType })" />
      </div>

      <div v-if="sendsDeck">
        <label class="mb-1 block text-sm font-medium" for="notif-batch">{{ t("web.notif.batch") }}</label>
        <AppSelect id="notif-batch" :model-value="String(notif.batchSize)" :options="batchOptions" :disabled="saving" @update:model-value="(value) => save({ batchSize: Number(value) })" />
      </div>

      <div>
        <label class="mb-1 block text-sm font-medium" for="notif-tz">{{ t("web.notif.timezone") }}</label>
        <AppSelect id="notif-tz" :model-value="notif.timezone" :options="timezoneOptions" :disabled="saving" @update:model-value="(value) => save({ timezone: value })" />
      </div>

      <form v-if="notif.type === 'contextual'" @submit.prevent="save({ context: context.trim() || null })">
        <label class="mb-1 block text-sm font-medium" for="notif-context">{{ t("web.notif.context") }}</label>
        <p class="mb-2 text-xs text-ink-muted">{{ t("web.notif.contextHint") }}</p>
        <textarea id="notif-context" v-model="context" class="field min-h-24" maxlength="500" />
        <button type="submit" class="btn-secondary mt-2" :disabled="saving">{{ t("web.common.save") }}</button>
      </form>
    </template>

    <p v-if="failed" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>
    <p v-else-if="saved" role="status" class="text-sm text-primary-soft-fg">{{ t("web.common.saved") }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { t } from "../lib/i18n";
import { saveNotifications, settings } from "../lib/settings-store";
import AppSelect from "./AppSelect.vue";
import { dismissOffer, isStandalone, pushPermission, pushSupported, subscribeThisDevice } from "../lib/push";
import type { NotificationChannel, NotificationPatch, NotificationType } from "../lib/types";

// The bot's grid: every half hour of the day.
const SLOTS = Array.from({ length: 48 }, (_, slot) => {
  const minutes = slot * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

const notif = computed(() => settings.value?.notifications ?? null);

const CHANNELS: NotificationChannel[] = ["bot", "web"];
// Only an app opened from the home screen can receive pushes on iOS, so a browser tab never offers it.
const appCanNotify = isStandalone() && pushSupported();
const permissionDenied = ref(appCanNotify && pushPermission() === "denied");

async function chooseChannel(channel: NotificationChannel): Promise<void> {
  if (channel === notif.value?.channel) return;
  if (channel === "bot") {
    dismissOffer();
    return save({ channel });
  }
  const key = notif.value?.pushPublicKey;
  if (!key) return;
  saving.value = true;
  failed.value = false;
  try {
    const subscribed = await subscribeThisDevice(key, false);
    permissionDenied.value = !subscribed;
    if (!subscribed) return;
  } catch {
    failed.value = true;
    return;
  } finally {
    saving.value = false;
  }
  await save({ channel });
}
const context = ref(notif.value?.context ?? "");
const saving = ref(false);
const saved = ref(false);
const failed = ref(false);

// Contextual and expressions reminders bring AI content, never a deck, so the deck size does nothing for them.
const sendsDeck = computed(() => notif.value?.type !== "contextual" && notif.value?.type !== "expressions");

const timezones = computed(() => {
  const current = notif.value?.timezone ?? "UTC";
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set(["UTC", current, ...all])];
});

const typeOptions = computed(() =>
  (notif.value?.options.types ?? []).map((type) => ({ value: type, label: t(`web.notif.type.${type}`) })),
);
const batchOptions = computed(() => (notif.value?.options.batchSizes ?? []).map((size) => ({ value: String(size), label: String(size) })));
const timezoneOptions = computed(() => timezones.value.map((zone) => ({ value: zone, label: zone })));

// The last time cannot be removed: an empty schedule means "not configured", as in the bot.
function canToggle(slot: string): boolean {
  const times = notif.value?.times ?? [];
  if (times.includes(slot)) return times.length > 1;
  return times.length < (notif.value?.options.maxTimes ?? 0);
}

function toggleTime(slot: string): void {
  const times = notif.value?.times ?? [];
  void save({ times: times.includes(slot) ? times.filter((time) => time !== slot) : [...times, slot] });
}

async function save(patch: NotificationPatch): Promise<void> {
  saving.value = true;
  saved.value = false;
  failed.value = false;
  try {
    await saveNotifications(patch);
    saved.value = true;
  } catch {
    failed.value = true;
  } finally {
    saving.value = false;
  }
}
</script>

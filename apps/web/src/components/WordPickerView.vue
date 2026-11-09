<template>
  <section class="space-y-4">
    <a href="/learn/" class="-my-2 inline-flex min-h-11 items-center text-sm text-ink-muted hover:underline">{{ t("web.learn.back") }}</a>
    <h1 class="text-2xl font-bold tracking-tight">✨ {{ t("web.learn.pick") }}</h1>

    <p v-if="loading" class="text-sm text-ink-muted" role="status">{{ t("web.common.loading") }}</p>
    <p v-else-if="noLanguage" class="card text-sm">{{ t("web.learn.pick.noLanguage") }}</p>
    <p v-else-if="presets.length === 0 && !set" class="card text-sm">{{ t("web.learn.pick.noPresets") }}</p>

    <template v-else-if="!set && !busy">
      <p class="text-sm">{{ empty ? t("web.learn.pick.nothingNew") : t("web.learn.pick.intro") }}</p>
      <ul class="grid gap-2 sm:grid-cols-2">
        <li v-for="preset in presets" :key="preset.id">
          <button type="button" class="card w-full text-left font-semibold hover:bg-surface-muted" @click="choose(preset)">
            {{ preset.emoji }} {{ preset.title }}
          </button>
        </li>
      </ul>
      <div v-if="chosen && chosen.langs.length > 1" class="space-y-2">
        <p class="text-sm">{{ t("web.learn.pick.chooseLang") }}</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="option in chosen.langs" :key="option.code" type="button" class="btn-secondary" @click="generate(chosen, option.code)">
            {{ option.flag }} {{ option.name }}
          </button>
        </div>
      </div>
    </template>

    <p v-if="busy" class="text-sm text-ink-muted" role="status">{{ t("web.learn.pick.generating") }}</p>
    <LimitNotice v-if="limit" :reason="limit.reason" :reset-at="limit.resetAt" />
    <p v-else-if="errorKey" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t(errorKey) }}</p>

    <article v-if="set && !busy" class="card space-y-4" aria-live="polite">
      <header>
        <h2 class="text-lg font-semibold">{{ set.run.emoji }} {{ set.run.title }}</h2>
        <p class="text-sm text-ink-muted">{{ set.run.lang.flag }} {{ set.run.lang.name }} · {{ t("web.learn.pick.hint") }}</p>
      </header>
      <ul class="space-y-3">
        <li v-for="item in set.items" :key="item.id" class="flex items-start justify-between gap-3 rounded-xl bg-surface-muted px-4 py-3 text-sm">
          <div class="min-w-0 space-y-1">
            <p class="font-semibold">{{ item.emoji }} {{ item.word }} <span class="font-normal">— {{ item.nativeTranslation }}</span></p>
            <p v-if="item.note" class="text-ink-muted">💡 {{ item.note }}</p>
            <p v-if="item.exampleTarget" class="italic">{{ item.exampleTarget }}</p>
          </div>
          <button type="button" class="btn-secondary shrink-0" :disabled="item.saved" @click="save(item)">
            {{ item.saved ? t("web.common.saved") : t("web.common.save") }}
          </button>
        </li>
      </ul>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-secondary" :disabled="set.items.every((item) => item.saved)" @click="saveAll">
          {{ t("web.learn.pick.saveAll") }}
        </button>
        <button type="button" class="btn-primary" @click="more">{{ t("web.learn.pick.more") }}</button>
        <button type="button" class="btn-secondary" @click="set = null">{{ t("web.learn.back") }}</button>
      </div>
    </article>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { learnApi, type PickedSet, type PickItem, type PickPreset } from "../lib/learn-api";
import LimitNotice from "./LimitNotice.vue";

const loading = ref(true);
const noLanguage = ref(false);
const presets = ref<PickPreset[]>([]);
const chosen = ref<PickPreset | null>(null);
const set = ref<PickedSet | null>(null);
const busy = ref(false);
const empty = ref(false);
const limit = ref<{ reason?: "plan" | "daily_ceiling"; resetAt?: string } | null>(null);
const errorKey = ref<string | null>(null);

function choose(preset: PickPreset): void {
  chosen.value = preset;
  // One learning language means there is nothing to choose — straight to the set, as in the bot.
  const only = preset.langs.length === 1 ? preset.langs[0] : undefined;
  if (only) void generate(preset, only.code);
}

async function generate(preset: PickPreset, lang: string): Promise<void> {
  busy.value = true;
  limit.value = null;
  errorKey.value = null;
  try {
    const outcome = await learnApi.pickSet(preset.id, lang);
    if (outcome.status === "empty") {
      empty.value = true;
      set.value = null;
      chosen.value = null;
      presets.value = outcome.others;
    } else {
      empty.value = false;
      set.value = { run: outcome.run, items: outcome.items };
    }
  } catch (err) {
    if (err instanceof ApiError && err.code === "limit")
      limit.value = { reason: err.body.reason as "plan" | "daily_ceiling", resetAt: err.body.resetAt };
    else if (err instanceof ApiError && err.code === "preset_gone") errorKey.value = "web.learn.pick.presetGone";
    else errorKey.value = "web.learn.pick.failed";
  } finally {
    busy.value = false;
  }
}

function more(): void {
  const current = set.value;
  const preset = presets.value.find((p) => p.id === current?.run.presetId);
  if (current && preset) void generate(preset, current.run.lang.code);
}

async function save(item: PickItem): Promise<void> {
  try {
    await learnApi.pickSave(item.id);
    item.saved = true;
  } catch {
    errorKey.value = "web.learn.pick.stale";
  }
}

async function saveAll(): Promise<void> {
  const current = set.value;
  if (!current) return;
  try {
    await learnApi.pickSaveAll(current.run.id);
    for (const item of current.items) item.saved = true;
  } catch {
    errorKey.value = "web.learn.pick.stale";
  }
}

onMounted(async () => {
  try {
    const listing = await learnApi.pickPresets();
    presets.value = listing.presets;
    noLanguage.value = listing.noLanguage;
  } catch {
    errorKey.value = "web.common.error";
  } finally {
    loading.value = false;
  }
});
</script>

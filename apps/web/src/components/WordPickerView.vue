<template>
  <section class="space-y-5">
    <a href="/learn/" class="-mb-2 flex w-fit min-h-11 items-center text-sm text-ink-muted hover:underline">{{ t("web.learn.back") }}</a>
    <h1 class="page-title">{{ t("web.learn.pick") }}</h1>

    <MonsterLoader v-if="loading" compact :label="t('web.common.loading')" />
    <p v-else-if="noLanguage" class="card text-base">{{ t("web.learn.pick.noLanguage") }}</p>
    <p v-else-if="presets.length === 0 && !set" class="card text-base">{{ t("web.learn.pick.noPresets") }}</p>

    <template v-else-if="!set && !busy">
      <p class="text-base text-ink-muted">{{ empty ? t("web.learn.pick.nothingNew") : t("web.learn.pick.intro") }}</p>
      <!-- The language comes first and stays in view: asked after the tap, it opened below the list, off-screen on a phone. -->
      <div v-if="langs.length > 1">
        <label class="mb-1 block text-sm font-medium" for="pick-lang">{{ t("web.learn.pick.chooseLang") }}</label>
        <AppSelect id="pick-lang" v-model="lang" :options="langs.map((option) => ({ value: option.code, label: option.name, lang: option.code }))" />
      </div>
      <ul class="grid gap-3 sm:grid-cols-2">
        <li v-for="preset in shownPresets" :key="preset.id">
          <button type="button" class="card flex min-h-16 w-full items-center gap-3 text-left text-xl font-semibold hover:bg-surface-muted" @click="generate(preset.id)">
            <span class="text-2xl" aria-hidden="true">{{ preset.emoji }}</span>{{ preset.title }}
          </button>
        </li>
      </ul>
    </template>

    <MonsterLoader v-if="busy" compact :label="t('web.learn.pick.generating')" />
    <LimitNotice v-if="limit" :reason="limit.reason" :reset-at="limit.resetAt" />
    <p v-else-if="errorKey" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t(errorKey) }}</p>

    <section v-if="set && !busy" class="space-y-4" aria-live="polite">
      <header class="space-y-2">
        <h2 class="text-2xl font-semibold">{{ set.run.emoji }} {{ set.run.title }}</h2>
        <LangBadge :code="set.run.lang.code" :label="set.run.lang.name" />
      </header>
      <ul class="space-y-3">
        <PickItemCard
          v-for="item in set.items"
          :key="item.id"
          :item="item"
          :native-lang="nativeLang"
          :saving="savingIds.has(item.id)"
          @save="save(item)"
        />
      </ul>
      <!-- Right-handed thumb zone: the main action, more words, sits last on the right. -->
      <div class="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <button type="button" class="btn-secondary" @click="set = null">{{ t("web.learn.pick.otherTopics") }}</button>
        <button type="button" class="btn-secondary" :disabled="set.items.every((item) => item.saved)" @click="saveAll">
          {{ t("web.learn.pick.saveAll") }}
        </button>
        <button type="button" class="btn-primary col-span-2" @click="generate(set.run.presetId)">{{ t("web.learn.pick.more") }}</button>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { type LangOption, learnApi, type PickedSet, type PickItem, type PickPreset } from "../lib/learn-api";
import { settings } from "../lib/settings-store";
import AppSelect from "./AppSelect.vue";
import LangBadge from "./LangBadge.vue";
import LimitNotice from "./LimitNotice.vue";
import MonsterLoader from "./MonsterLoader.vue";
import PickItemCard from "./PickItemCard.vue";

const loading = ref(true);
const noLanguage = ref(false);
const presets = ref<PickPreset[]>([]);
const lang = ref<string | undefined>(undefined);
const set = ref<PickedSet | null>(null);
const busy = ref(false);
const empty = ref(false);
const savingIds = ref(new Set<number>());
const limit = ref<{ reason?: "plan" | "daily_ceiling"; resetAt?: string } | null>(null);
const errorKey = ref<string | null>(null);

const nativeLang = computed(() => settings.value?.nativeLang ?? "");

const langs = computed<LangOption[]>(() => {
  const seen = new Map<string, LangOption>();
  for (const preset of presets.value) for (const option of preset.langs) if (!seen.has(option.code)) seen.set(option.code, option);
  return [...seen.values()];
});

const shownPresets = computed(() => presets.value.filter((preset) => preset.langs.some((option) => option.code === lang.value)));

function keepLangValid(): void {
  if (!langs.value.some((option) => option.code === lang.value)) lang.value = langs.value[0]?.code;
}

async function generate(presetId: number | null): Promise<void> {
  const code = set.value?.run.lang.code ?? lang.value;
  if (presetId === null || !code) return;
  busy.value = true;
  limit.value = null;
  errorKey.value = null;
  try {
    const outcome = await learnApi.pickSet(presetId, code);
    if (outcome.status === "empty") {
      empty.value = true;
      set.value = null;
      presets.value = outcome.others;
      keepLangValid();
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

async function save(item: PickItem): Promise<void> {
  savingIds.value = new Set(savingIds.value).add(item.id);
  try {
    await learnApi.pickSave(item.id);
    item.saved = true;
  } catch {
    errorKey.value = "web.learn.pick.stale";
  } finally {
    const next = new Set(savingIds.value);
    next.delete(item.id);
    savingIds.value = next;
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
    keepLangValid();
  } catch {
    errorKey.value = "web.common.error";
  } finally {
    loading.value = false;
  }
});
</script>

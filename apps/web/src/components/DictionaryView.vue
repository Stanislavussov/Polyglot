<template>
  <section class="min-w-0">
    <h1 class="page-title">{{ t("web.dictionary.title") }}</h1>

    <DictionarySwitcher
      v-if="dictionaries.length > 0"
      :dictionaries="dictionaries"
      :current-id="data?.dictionary.id ?? dictionaryId"
      @select="selectDictionary"
      @changed="onDictionariesChanged"
    />

    <div ref="toolbar" class="mt-6 flex scroll-mt-20 gap-2 sm:gap-3 md:scroll-mt-6">
      <label class="sr-only" for="dictionary-search">{{ t("web.dictionary.search") }}</label>
      <div class="relative min-w-0 flex-1">
        <Search class="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input
          id="dictionary-search"
          ref="searchInput"
          v-model="query"
          type="search"
          class="field text-ellipsis pl-10 pr-3 placeholder:text-sm sm:placeholder:text-base [@media(hover:hover)_and_(pointer:fine)]:pr-10 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-ring"
          :placeholder="t(isDesktop ? 'web.dictionary.searchHint' : 'web.dictionary.search')"
        />
        <kbd
          v-if="query === ''"
          class="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-line bg-surface-muted px-1.5 font-sans text-xs text-ink-muted [@media(hover:hover)_and_(pointer:fine)]:block"
          aria-hidden="true"
        >/</kbd>
      </div>
      <div class="flex shrink-0 gap-2 sm:gap-3">
      <PopoverRoot v-model:open="filtersOpen">
        <PopoverTrigger class="btn-secondary relative shrink-0 gap-2 px-3 sm:px-4" :aria-label="filterButtonLabel">
          <SlidersHorizontal class="size-5 sm:size-4" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.dictionary.filters") }}</span>
          <span
            v-if="activeCount > 0"
            class="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-fg"
            aria-hidden="true"
          >{{ activeCount }}</span>
        </PopoverTrigger>
        <PopoverPortal v-if="isDesktop">
          <PopoverContent
            align="end"
            :side-offset="8"
            class="z-30 w-80 rounded-2xl border border-line bg-surface p-4 shadow-xl"
          >
            <DictionaryFilters :model-value="filters" :active-count="activeCount" @update="setFilter" @reset="resetFilters" />
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
      <button
        type="button"
        class="btn-secondary shrink-0 gap-2 px-3 sm:px-4"
        :aria-label="`${t('web.dictionary.sort')}: ${t(currentSort.label)}`"
        @click="toggleSort"
      >
        <component :is="currentSort.icon" class="size-5 sm:size-4" aria-hidden="true" /><span class="hidden sm:inline">{{ t(currentSort.label) }}</span>
      </button>
      </div>
    </div>

    <BottomSheet :open="!isDesktop && filtersOpen" @close="filtersOpen = false">
      <template #title>{{ t("web.dictionary.filters") }}</template>
      <DictionaryFilters :model-value="filters" :active-count="activeCount" @update="setFilter" @reset="resetFilters" />
    </BottomSheet>

    <div
      role="group"
      :aria-label="t('web.dictionary.filterLang')"
      class="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <button
        v-for="option in langOptions"
        :key="option.code"
        type="button"
        :aria-pressed="filters.lang === option.code"
        :class="[
          'inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors',
          filters.lang === option.code ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface text-ink hover:bg-surface-muted',
        ]"
        @click="setFilter('lang', option.code)"
      >
        <LangFlag v-if="option.flag" :code="option.code" />{{ option.label }}
      </button>
    </div>

    <ul v-if="activeChips.length > 0" class="mt-3 flex flex-wrap gap-2" :aria-label="t('web.dictionary.activeFilters')">
      <li v-for="chip in activeChips" :key="chip.key">
        <button
          type="button"
          class="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary-soft px-3 text-sm font-medium text-primary-soft-fg hover:opacity-80"
          :aria-label="t('web.dictionary.removeFilter', { filter: chip.label })"
          @click="setFilter(chip.key, '')"
        >
          {{ chip.label }}<X class="size-4" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <p v-if="failed" role="alert" class="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>
    <div v-else-if="loading && !data" class="card mt-6"><MonsterLoader :label="t('web.common.loading')" /></div>
    <div v-else-if="data && data.items.length === 0" class="mt-6">
      <p class="text-sm text-ink-muted">{{ filtersActive ? t("web.dictionary.emptyFiltered") : t("web.dictionary.empty") }}</p>
      <button v-if="filtersActive" type="button" class="btn-secondary mt-3" @click="resetFilters">{{ t("web.dictionary.filterReset") }}</button>
    </div>

    <ul v-if="data && data.items.length > 0" class="mt-6 space-y-3" :aria-busy="loading">
      <DictionaryRow
        v-for="item in data.items"
        :key="item.id"
        :item="item"
        :removed="removedIds.has(item.id)"
        :copied="copiedId === item.id"
        :busy="busyIds.has(item.id)"
        :others="otherDictionaries"
        @details="openId = item.id"
        @remove="remove(item)"
        @undo="undo(item)"
        @copy="copy(item)"
        @review="review(item)"
        @place="(to, move) => place(item, to, move)"
      />
    </ul>

    <p v-if="placedMessage" role="status" class="mt-4 rounded-xl bg-surface-muted px-4 py-3 text-sm">{{ placedMessage }}</p>

    <p v-if="actionFailed" role="alert" class="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>

    <EntryDetailDialog :entry-id="openId" :fallback="openItem" @close="openId = null" />

    <nav v-if="data && pageCount > 1" class="mt-6 flex items-center justify-between gap-3">
      <button type="button" class="btn-secondary px-3 sm:px-5" :disabled="page <= 1" @click="page -= 1">
        <ChevronLeft class="size-4" aria-hidden="true" /><span class="sr-only sm:not-sr-only">{{ t("web.dictionary.previous") }}</span>
      </button>
      <span class="min-w-0 whitespace-nowrap text-center text-sm text-ink-muted">{{ t("web.dictionary.page", { page, pages: pageCount }) }}</span>
      <button type="button" class="btn-secondary px-3 sm:px-5" :disabled="page >= pageCount" @click="page += 1">
        <span class="sr-only sm:not-sr-only">{{ t("web.dictionary.next") }}</span><ChevronRight class="size-4" aria-hidden="true" />
      </button>
    </nav>
  </section>
</template>

<script setup lang="ts">
import LangFlag from "./LangFlag.vue";
import MonsterLoader from "./MonsterLoader.vue";
import { ArrowDownAZ, ChevronLeft, ChevronRight, Clock, Search, SlidersHorizontal, X } from "lucide-vue-next";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ApiError, api } from "../lib/api";
import { t } from "../lib/i18n";
import { useMainInput } from "../lib/use-main-input";
import { languageFlag, languageName, settings } from "../lib/settings-store";
import type { Dictionary, DictionaryFilterState, DictionaryItem, DictionaryPage, DictionarySort } from "../lib/types";
import BottomSheet from "./BottomSheet.vue";
import DictionaryFilters from "./DictionaryFilters.vue";
import DictionaryRow from "./DictionaryRow.vue";
import DictionarySwitcher from "./DictionarySwitcher.vue";
import EntryDetailDialog from "./EntryDetailDialog.vue";

const SEARCH_DEBOUNCE_MS = 300;
const UNDO_WINDOW_MS = 6000;
const COPIED_MS = 1800;

const sorts = [
  { value: "recent", label: "web.dictionary.sortRecent", icon: Clock },
  { value: "alpha", label: "web.dictionary.sortAlpha", icon: ArrowDownAZ },
] as const;

const TYPES = ["word", "phrase", "sentence"];
const DIFFICULTIES = ["hard", "normal", "easy"];
const REVIEWS = ["due", "new", "learned"];

function pick<T extends string>(params: URLSearchParams, key: string, allowed: readonly string[]): T | "" {
  const value = params.get(key) ?? "";
  return allowed.includes(value) ? (value as T) : "";
}

// Filters live in the query string so a reload or a shared link keeps the same view.
const initial = new URLSearchParams(window.location.search);

const query = ref(initial.get("q") ?? "");
const sort = ref<DictionarySort>(initial.get("sort") === "alpha" ? "alpha" : "recent");
const currentSort = computed(() => (sort.value === "alpha" ? sorts[1] : sorts[0]));

function toggleSort(): void {
  sort.value = sort.value === "alpha" ? "recent" : "alpha";
}
const page = ref(Math.max(1, Number.parseInt(initial.get("page") ?? "1", 10) || 1));
const filters = ref<DictionaryFilterState>({
  lang: initial.get("lang") ?? "",
  type: pick(initial, "type", TYPES),
  difficulty: pick(initial, "difficulty", DIFFICULTIES),
  review: pick(initial, "review", REVIEWS),
});
const filtersOpen = ref(false);
// No id means the default dictionary, as the bot's /dictionary opens it.
const initialDictionary = Number.parseInt(initial.get("dict") ?? "", 10);
const dictionaryId = ref<number | null>(initialDictionary > 0 ? initialDictionary : null);
const dictionaries = ref<Dictionary[]>([]);
const placedMessage = ref("");
const toolbar = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const { focus: focusSearch } = useMainInput(() => searchInput.value);
const SHEET_EXIT_MS = 260;

// The popover only fits wide screens; below sm the same filters open as a bottom sheet.
const desktopQuery = window.matchMedia("(min-width: 640px)");
const isDesktop = ref(desktopQuery.matches);
const onViewportChange = (event: MediaQueryListEvent): void => {
  isDesktop.value = event.matches;
};
desktopQuery.addEventListener("change", onViewportChange);

const langOptions = computed(() => {
  const current = settings.value;
  const codes = current ? [...new Set([current.nativeLang, ...current.learningLangs])] : [];
  return [
    { code: "", flag: "", label: t("web.dictionary.filterAll") },
    ...codes.map((code) => ({ code, flag: languageFlag(code), label: languageName(code) })),
  ];
});

const LABELS = {
  type: { word: "web.dictionary.typeWord", phrase: "web.dictionary.typePhrase", sentence: "web.dictionary.typeSentence" },
  difficulty: { hard: "web.dictionary.difficulty.hard", normal: "web.dictionary.difficulty.normal", easy: "web.dictionary.difficulty.easy" },
  review: { due: "web.dictionary.reviewDue", new: "web.dictionary.reviewNew", learned: "web.dictionary.reviewLearned" },
} as const;

const activeChips = computed(() =>
  (["type", "difficulty", "review"] as const).flatMap((key) => {
    const value = filters.value[key];
    if (!value) return [];
    const labels: Record<string, string> = LABELS[key];
    return [{ key, label: t(labels[value] ?? value) }];
  }),
);
const activeCount = computed(() => activeChips.value.length);
const filtersActive = computed(() => activeCount.value > 0 || filters.value.lang !== "");
const filterButtonLabel = computed(() =>
  activeCount.value > 0 ? t("web.dictionary.filtersActive", { count: activeCount.value }) : t("web.dictionary.filters"),
);

// Any change to what the list shows restarts from page 1 and brings the list back into view.
let scrollAfterLoad = false;

function restart(): void {
  scrollAfterLoad = true;
  if (page.value !== 1) page.value = 1;
  else void load();
}

function setFilter(key: keyof DictionaryFilterState, value: string): void {
  filters.value = { ...filters.value, [key]: value };
  restart();
}

function resetFilters(): void {
  filters.value = { lang: "", type: "", difficulty: "", review: "" };
  restart();
}

function scrollToList(): void {
  const el = toolbar.value;
  if (!el || el.getBoundingClientRect().top >= 0) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

function syncUrl(): void {
  const params = new URLSearchParams();
  if (query.value.trim()) params.set("q", query.value.trim());
  if (sort.value !== "recent") params.set("sort", sort.value);
  if (page.value > 1) params.set("page", String(page.value));
  if (dictionaryId.value !== null) params.set("dict", String(dictionaryId.value));
  for (const key of ["lang", "type", "difficulty", "review"] as const) {
    if (filters.value[key]) params.set(key, filters.value[key]);
  }
  const search = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
}
const data = ref<DictionaryPage | null>(null);
const loading = ref(false);
const failed = ref(false);
const actionFailed = ref(false);
const openId = ref<number | null>(null);
const removedIds = ref(new Set<number>());
const busyIds = ref(new Set<number>());
const copiedId = ref<number | null>(null);
const undoTimers = new Map<number, ReturnType<typeof setTimeout>>();
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

const pageCount = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1));

const otherDictionaries = computed(() => dictionaries.value.filter((d) => d.id !== data.value?.dictionary.id));

async function loadDictionaries(): Promise<void> {
  try {
    dictionaries.value = (await api.dictionaries()).items;
  } catch {
    // The list still works without the switcher.
  }
}

function selectDictionary(id: number): void {
  dictionaryId.value = id;
  placedMessage.value = "";
  restart();
}

function onDictionariesChanged(selectId: number | null): void {
  void loadDictionaries();
  dictionaryId.value = selectId;
  placedMessage.value = "";
  restart();
}

async function place(item: DictionaryItem, to: number, move: boolean): Promise<void> {
  if (busyIds.value.has(item.id)) return;
  actionFailed.value = false;
  mark(busyIds, item.id, true);
  try {
    const target = await api.placeEntry(item.id, to, move ? data.value?.dictionary.id : undefined);
    placedMessage.value = t(move ? "web.dictionaries.moved" : "web.dictionaries.added", { name: target.name, word: item.original });
    if (move) finalize(item.id);
    void loadDictionaries();
  } catch {
    actionFailed.value = true;
  } finally {
    mark(busyIds, item.id, false);
  }
}

const openItem = computed(() => data.value?.items.find((item) => item.id === openId.value) ?? null);

function mark(set: typeof removedIds, id: number, on: boolean): void {
  const next = new Set(set.value);
  if (on) next.add(id);
  else next.delete(id);
  set.value = next;
}

// Once the undo window closes the row leaves the list and the total follows.
function finalize(id: number): void {
  undoTimers.delete(id);
  mark(removedIds, id, false);
  const page = data.value;
  if (!page?.items.some((item) => item.id === id)) return;
  data.value = { ...page, items: page.items.filter((item) => item.id !== id), total: Math.max(0, page.total - 1) };
}

async function remove(item: DictionaryItem): Promise<void> {
  if (busyIds.value.has(item.id)) return;
  actionFailed.value = false;
  mark(busyIds, item.id, true);
  try {
    await api.removeEntry(item.id, data.value?.dictionary.id);
    mark(removedIds, item.id, true);
    undoTimers.set(item.id, setTimeout(() => finalize(item.id), UNDO_WINDOW_MS));
  } catch {
    actionFailed.value = true;
  } finally {
    mark(busyIds, item.id, false);
    focusSearch();
  }
}

async function undo(item: DictionaryItem): Promise<void> {
  if (busyIds.value.has(item.id)) return;
  actionFailed.value = false;
  mark(busyIds, item.id, true);
  clearTimeout(undoTimers.get(item.id));
  try {
    await api.restoreEntry(item.id, data.value?.dictionary.id);
    undoTimers.delete(item.id);
    mark(removedIds, item.id, false);
  } catch {
    actionFailed.value = true;
    undoTimers.set(item.id, setTimeout(() => finalize(item.id), UNDO_WINDOW_MS));
  } finally {
    mark(busyIds, item.id, false);
    focusSearch();
  }
}

async function copy(item: DictionaryItem): Promise<void> {
  const text = `${item.original} — ${item.translations.map((translation) => `${translation.lang}: ${translation.text}`).join("; ")}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  copiedId.value = item.id;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedId.value = null;
  }, COPIED_MS);
}

function review(item: DictionaryItem): void {
  window.location.assign(`/review/?entry=${item.id}`);
}

// A stale response must not overwrite a newer one when the learner types fast.
let requestId = 0;

async function load(): Promise<void> {
  const id = ++requestId;
  loading.value = true;
  failed.value = false;
  try {
    const next = await api.dictionary({
      q: query.value.trim(),
      sort: sort.value,
      page: page.value,
      dictionary: dictionaryId.value ?? undefined,
      ...filters.value,
    });
    if (id === requestId) {
      data.value = next;
      if (scrollAfterLoad) {
        scrollAfterLoad = false;
        await nextTick();
        scrollToList();
        focusSearch();
      }
    }
  } catch (error) {
    // A dictionary deleted in the bot, or a stale link: fall back to the default one.
    if (id === requestId && error instanceof ApiError && error.status === 404 && dictionaryId.value !== null) {
      dictionaryId.value = null;
      void load();
      return;
    }
    if (id === requestId) failed.value = true;
  } finally {
    if (id === requestId) loading.value = false;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;

watch(query, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    page.value = 1;
    void load();
  }, SEARCH_DEBOUNCE_MS);
});

watch(sort, restart);

watch(filtersOpen, (open) => {
  if (!open) focusSearch(SHEET_EXIT_MS);
});

watch(openId, (id) => {
  if (id === null) focusSearch(SHEET_EXIT_MS);
});

watch(page, () => {
  scrollAfterLoad = true;
  void load();
});

watch([query, sort, page, filters, dictionaryId], syncUrl);

onMounted(() => {
  void load();
  void loadDictionaries();
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  clearTimeout(copiedTimer);
  desktopQuery.removeEventListener("change", onViewportChange);
  for (const undoTimer of undoTimers.values()) clearTimeout(undoTimer);
});
</script>

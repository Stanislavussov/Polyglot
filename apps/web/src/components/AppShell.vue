<template>
  <p v-if="!ready" class="p-6 text-sm text-ink-muted" role="status">{{ t("web.common.loading") }}</p>
  <div v-else class="flex min-h-screen flex-col md:flex-row">
    <aside class="hidden w-60 shrink-0 flex-col bg-sidebar md:sticky md:top-0 md:flex md:h-screen">
      <div class="flex h-16 items-center px-5 text-xl font-bold tracking-tight text-sidebar-fg">Polyglot</div>
      <div class="min-h-0 flex-1 overflow-y-auto"><NavList :page="page" /></div>
      <SignOutButton />
    </aside>

    <header class="flex h-14 items-center gap-3 bg-sidebar px-3 text-sidebar-fg md:hidden">
      <button
        type="button"
        class="grid size-11 place-items-center rounded-xl hover:bg-sidebar-hover"
        :aria-label="t('web.nav.openMenu')"
        @click="drawerOpen = true"
      >
        <Menu class="size-6" aria-hidden="true" />
      </button>
      <span class="text-lg font-bold tracking-tight">Polyglot</span>
    </header>

    <DialogRoot v-model:open="drawerOpen">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-40 bg-ink opacity-50 md:hidden" />
        <DialogContent
          class="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar text-sidebar-fg shadow-xl md:hidden"
          :aria-describedby="undefined"
        >
          <div class="flex h-14 items-center justify-between px-5">
            <DialogTitle class="text-lg font-bold tracking-tight">Polyglot</DialogTitle>
            <DialogClose
              class="grid size-11 place-items-center rounded-xl hover:bg-sidebar-hover"
              :aria-label="t('web.nav.closeMenu')"
            >
              <X class="size-5" aria-hidden="true" />
            </DialogClose>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto"><NavList :page="page" /></div>
          <SignOutButton />
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <main class="min-w-0 flex-1">
      <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:px-8 md:py-10">
        <component :is="content" />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { Menu, X } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { t } from "../lib/i18n";
import { loadSettings } from "../lib/settings-store";
import type { PageName } from "../lib/types";
import DictionaryView from "./DictionaryView.vue";
import NavList from "./NavList.vue";
import ReviewView from "./ReviewView.vue";
import SettingsView from "./SettingsView.vue";
import SignOutButton from "./SignOutButton.vue";
import TranslateView from "./TranslateView.vue";

const props = defineProps<{ page: PageName }>();

const views = {
  translate: TranslateView,
  dictionary: DictionaryView,
  review: ReviewView,
  settings: SettingsView,
} as const;

const content = computed(() => views[props.page]);
const ready = ref(false);
const drawerOpen = ref(false);

onMounted(async () => {
  // A 401 here redirects to the login page inside the api client; any other failure still renders the shell in English.
  await loadSettings().catch(() => undefined);
  ready.value = true;
});
</script>

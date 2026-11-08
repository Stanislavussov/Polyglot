<template>
  <ShellSkeleton v-if="!ready" :label="t('web.common.loading')" />
  <div v-else class="flex min-h-screen flex-col md:flex-row">
    <aside class="hidden w-60 shrink-0 flex-col bg-sidebar md:sticky md:top-0 md:flex md:h-screen">
      <div class="flex h-16 items-center gap-2.5 whitespace-nowrap px-5 text-lg font-bold tracking-tight text-sidebar-fg"><img src="/favicon.svg" alt="" class="size-8 rounded-lg" /> Polyglot Monster</div>
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
      <span class="flex items-center gap-2 text-lg font-bold tracking-tight"><img src="/favicon.svg" alt="" class="size-7 rounded-lg" /> Polyglot Monster</span>
    </header>

    <DialogRoot v-model:open="drawerOpen">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-40 bg-ink opacity-50 md:hidden" />
        <DialogContent
          class="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar text-sidebar-fg shadow-xl md:hidden"
          :aria-describedby="undefined"
        >
          <div class="flex h-14 items-center justify-between px-5">
            <DialogTitle class="flex items-center gap-2 text-lg font-bold tracking-tight"><img src="/favicon.svg" alt="" class="size-7 rounded-lg" /> Polyglot Monster</DialogTitle>
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
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { drawerSwipeAction, type SwipePoint } from "../lib/drawer-swipe";
import { t } from "../lib/i18n";
import { loadSettings } from "../lib/settings-store";
import type { PageName } from "../lib/types";
import DictionaryView from "./DictionaryView.vue";
import ExpressionsView from "./ExpressionsView.vue";
import GrammarCheckView from "./GrammarCheckView.vue";
import LearnView from "./LearnView.vue";
import MentorChatView from "./MentorChatView.vue";
import NavList from "./NavList.vue";
import PlanView from "./PlanView.vue";
import ReviewView from "./ReviewView.vue";
import SettingsView from "./SettingsView.vue";
import ShellSkeleton from "./ShellSkeleton.vue";
import SignOutButton from "./SignOutButton.vue";
import TranslateView from "./TranslateView.vue";
import VideosView from "./VideosView.vue";
import WordPickerView from "./WordPickerView.vue";

const props = defineProps<{ page: PageName }>();

const views = {
  translate: TranslateView,
  dictionary: DictionaryView,
  review: ReviewView,
  settings: SettingsView,
  plan: PlanView,
  learn: LearnView,
  mentor: MentorChatView,
  grammar: GrammarCheckView,
  expressions: ExpressionsView,
  pick: WordPickerView,
  videos: VideosView,
} as const;

const content = computed(() => views[props.page]);
const ready = ref(false);
const drawerOpen = ref(false);

onMounted(async () => {
  // A 401 here redirects to the login page inside the api client; any other failure still renders the shell in English.
  await loadSettings().catch(() => undefined);
  ready.value = true;
});

let swipeStart: SwipePoint | null = null;

function onTouchStart(event: TouchEvent): void {
  const touch = event.touches[0];
  swipeStart = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function onTouchEnd(event: TouchEvent): void {
  const touch = event.changedTouches[0];
  if (!swipeStart || !touch || window.matchMedia("(min-width: 768px)").matches) return;
  const action = drawerSwipeAction(swipeStart, { x: touch.clientX, y: touch.clientY }, drawerOpen.value);
  swipeStart = null;
  if (action) drawerOpen.value = action === "open";
}

onMounted(() => {
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchend", onTouchEnd, { passive: true });
});

onBeforeUnmount(() => {
  window.removeEventListener("touchstart", onTouchStart);
  window.removeEventListener("touchend", onTouchEnd);
});
</script>

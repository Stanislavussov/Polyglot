<template>
  <ShellSkeleton v-if="!ready" :label="t('web.common.loading')" />
  <div v-else class="flex min-h-screen flex-col md:flex-row">
    <aside class="hidden w-64 shrink-0 flex-col bg-sidebar md:sticky md:top-0 md:flex md:h-screen">
      <div class="flex h-16 items-center gap-2.5 whitespace-nowrap px-5 text-xl font-display font-extrabold tracking-tight text-sidebar-fg"><img src="/favicon.svg" alt="" class="size-8 rounded-lg" /> Polyglot Monster</div>
      <div class="min-h-0 flex-1 overflow-y-auto"><NavList :page="page" @navigate="navigate" /></div>
      <UserMenu :active="page === 'settings' || page === 'plan'" @navigate="navigate" />
    </aside>

    <header class="sticky top-0 z-30 flex h-14 items-center gap-3 bg-sidebar px-3 text-sidebar-fg md:hidden">
      <button
        type="button"
        class="grid size-11 place-items-center rounded-full hover:bg-sidebar-hover"
        :aria-label="t('web.nav.openMenu')"
        @click="drawerOpen = true"
      >
        <Menu class="size-6" aria-hidden="true" />
      </button>
      <span class="flex items-center gap-2 text-xl font-display font-extrabold tracking-tight"><img src="/favicon.svg" alt="" class="size-7 rounded-lg" /> Polyglot Monster</span>
    </header>

    <DialogRoot v-model:open="drawerOpen">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-40 bg-ink opacity-50 md:hidden" />
        <DialogContent
          class="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar text-sidebar-fg shadow-xl md:hidden"
          :aria-describedby="undefined"
        >
          <div class="flex h-14 items-center justify-between px-5">
            <DialogTitle class="flex items-center gap-2 text-xl font-display font-extrabold tracking-tight"><img src="/favicon.svg" alt="" class="size-7 rounded-lg" /> Polyglot Monster</DialogTitle>
            <DialogClose
              class="grid size-11 place-items-center rounded-full hover:bg-sidebar-hover"
              :aria-label="t('web.nav.closeMenu')"
            >
              <X class="size-5" aria-hidden="true" />
            </DialogClose>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto"><NavList :page="page" @navigate="navigate" /></div>
          <UserMenu :active="page === 'settings' || page === 'plan'" @navigate="navigate" />
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <main class="relative isolate min-w-0 flex-1">
      <div class="pointer-events-none fixed inset-0 -z-10 md:left-64" aria-hidden="true">
        <div class="backdrop-blob -right-40 -top-40 size-[32rem]" />
        <div class="backdrop-ring -right-28 top-24 size-96" />
        <div class="backdrop-dot right-[14%] top-10 size-2.5" />
        <div class="backdrop-dot bottom-[16%] right-[9%] size-1.5 opacity-60" />
      </div>
      <div v-if="goalText && page !== 'progress'" class="mx-auto max-w-6xl px-4 pt-3 sm:px-6 md:px-8">
        <div v-if="!bar.snoozed.value" class="flex items-center gap-2 rounded-full bg-primary-soft py-1 pl-4 pr-1 text-sm text-primary-soft-fg">
          <a href="/progress/" class="min-w-0 flex-1 truncate hover:underline" @click.prevent="navigate('progress')">{{ goalText }}</a>
          <button
            type="button"
            class="grid size-8 shrink-0 place-items-center rounded-full hover:bg-surface"
            :aria-label="t('web.progress.barHide')"
            :title="t('web.progress.barHide')"
            @click="bar.hide()"
          >
            <X class="size-4" aria-hidden="true" />
          </button>
        </div>
        <div v-else class="flex justify-end">
          <button
            type="button"
            class="rounded-full px-2 py-0.5 text-sm text-ink-muted hover:bg-primary-soft hover:text-primary-soft-fg"
            :aria-label="t('web.progress.barShow')"
            :title="t('web.progress.barShow')"
            @click="bar.show()"
          >
            🎯
          </button>
        </div>
      </div>
      <div v-if="pushOffer || pushSwitched" class="mx-auto max-w-6xl px-4 pt-3 sm:px-6 md:px-8">
        <div v-if="pushOffer" class="flex flex-wrap items-center gap-2 rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary-soft-fg">
          <span class="min-w-0 flex-1">{{ t("web.push.bannerText") }}</span>
          <button type="button" class="btn-primary" @click="acceptPushOffer">{{ t("web.push.bannerEnable") }}</button>
          <button type="button" class="btn-secondary" @click="declinePushOffer">{{ t("web.push.bannerDismiss") }}</button>
        </div>
        <p v-else role="status" class="flex items-center gap-2 rounded-2xl bg-primary-soft px-4 py-3 text-sm text-primary-soft-fg">
          <span class="min-w-0 flex-1">{{ t("web.push.switched") }}</span>
          <button type="button" class="grid size-8 shrink-0 place-items-center rounded-full hover:bg-surface" :aria-label="t('web.push.noticeClose')" @click="pushSwitched = false">
            <X class="size-4" aria-hidden="true" />
          </button>
        </p>
      </div>
      <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:px-8 md:py-10">
        <component :is="content" :key="page" />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { Menu, X } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api } from "../lib/api";
import { drawerSwipeAction, type SwipePoint } from "../lib/drawer-swipe";
import { t } from "../lib/i18n";
import {
  decideAutoSwitch,
  dismissOffer,
  isStandalone,
  markSwitchNoticeShown,
  offerDismissed,
  pushPermission,
  pushSupported,
  registerServiceWorker,
  subscribeThisDevice,
  switchNoticeShown,
} from "../lib/push";
import { loadSettings, settings } from "../lib/settings-store";
import type { PageName, ProgressGoal } from "../lib/types";
import { useProgressBar } from "../lib/use-progress-bar";
import DictionaryView from "./DictionaryView.vue";
import ExpressionsView from "./ExpressionsView.vue";
import GrammarCheckView from "./GrammarCheckView.vue";
import LearnView from "./LearnView.vue";
import MentorChatView from "./MentorChatView.vue";
import NavList from "./NavList.vue";
import PlanView from "./PlanView.vue";
import ProgressView from "./ProgressView.vue";
import ReviewView from "./ReviewView.vue";
import SettingsView from "./SettingsView.vue";
import ShellSkeleton from "./ShellSkeleton.vue";
import TranslateView from "./TranslateView.vue";
import ArticlesView from "./ArticlesView.vue";
import VideosView from "./VideosView.vue";
import WordPickerView from "./WordPickerView.vue";
import WelcomeView from "./WelcomeView.vue";
import UserMenu from "./UserMenu.vue";

const props = defineProps<{ page: PageName }>();

const views = {
  translate: TranslateView,
  dictionary: DictionaryView,
  review: ReviewView,
  progress: ProgressView,
  welcome: WelcomeView,
  settings: SettingsView,
  plan: PlanView,
  learn: LearnView,
  mentor: MentorChatView,
  grammar: GrammarCheckView,
  expressions: ExpressionsView,
  pick: WordPickerView,
  videos: VideosView,
  articles: ArticlesView,
} as const;

const PAGE_PATH: Record<PageName, string> = {
  translate: "/translate/",
  dictionary: "/dictionary/",
  review: "/review/",
  progress: "/progress/",
  settings: "/settings/",
  welcome: "/welcome/",
  plan: "/plan/",
  learn: "/learn/",
  mentor: "/learn/mentor/",
  grammar: "/learn/grammar/",
  expressions: "/learn/expressions/",
  pick: "/learn/pick/",
  videos: "/learn/videos/",
  articles: "/learn/articles/",
};
const PAGE_TITLE: Record<PageName, string> = {
  translate: "Translate",
  dictionary: "Dictionary",
  review: "Review",
  progress: "Progress",
  settings: "Settings",
  welcome: "Welcome",
  plan: "Plan",
  learn: "Learn",
  mentor: "Mentor",
  grammar: "Grammar check",
  expressions: "Expressions",
  pick: "Pick words",
  videos: "Videos",
  articles: "Articles",
};

// Each page is its own Astro document; switching views in place keeps the menu from re-rendering on every click.
const page = ref<PageName>(props.page);
const content = computed(() => views[page.value]);

function show(target: PageName): void {
  page.value = target;
  document.title = `${PAGE_TITLE[target]} — Polyglot`;
  drawerOpen.value = false;
}

function navigate(target: PageName): void {
  if (target !== page.value || window.location.search !== "") {
    window.history.pushState({ page: target }, "", PAGE_PATH[target]);
  }
  show(target);
}

function onPopState(): void {
  const target = (Object.keys(PAGE_PATH) as PageName[]).find((name) => PAGE_PATH[name] === window.location.pathname);
  if (target) show(target);
  else window.location.reload();
}
const ready = ref(false);
const drawerOpen = ref(false);
const bar = useProgressBar();
const goal = ref<ProgressGoal | null>(null);
// A gift granted by this very open outranks the next step: it is announced exactly once.
const goalText = computed(() => goal.value?.rewards[0] ?? goal.value?.nearest ?? null);

onMounted(async () => {
  // A 401 here redirects to the login page inside the api client; any other failure still renders the shell in English.
  await loadSettings().catch(() => undefined);
  // A learner who never finished the bot's onboarding gets the same first steps here.
  if (props.page !== "welcome") {
    const me = await api.me().catch(() => null);
    if (me && !me.onboarded) {
      window.location.replace("/welcome/");
      return;
    }
  }
  ready.value = true;
  registerServiceWorker();
  void autoSwitchToApp();
});

const pushOffer = ref(false);
const pushSwitched = ref(false);

// An installed app takes over reminders the learner already gets in Telegram.
async function autoSwitchToApp(): Promise<void> {
  const notif = settings.value?.notifications;
  if (!notif) return;
  const action = decideAutoSwitch({
    standalone: isStandalone(),
    supported: pushSupported(),
    pushAvailable: notif.pushPublicKey !== null,
    notificationsEnabled: notif.enabled,
    channel: notif.channel,
    permission: pushPermission(),
    dismissed: offerDismissed(),
  });
  if (action === "subscribe") await switchToApp();
  else if (action === "offer") pushOffer.value = true;
}

async function switchToApp(): Promise<void> {
  const key = settings.value?.notifications.pushPublicKey;
  if (!key) return;
  // One automatic switch per device: a later return to Telegram must stick.
  dismissOffer();
  const subscribed = await subscribeThisDevice(key, true).catch(() => false);
  if (subscribed && settings.value?.notifications.channel === "web" && !switchNoticeShown()) {
    markSwitchNoticeShown();
    pushSwitched.value = true;
  }
}

// The permission prompt must come from this tap: iOS ignores it otherwise.
async function acceptPushOffer(): Promise<void> {
  pushOffer.value = false;
  await switchToApp();
}

function declinePushOffer(): void {
  pushOffer.value = false;
  dismissOffer();
}

// Fetched only off the Progress tab: that tab announces a fresh gift itself, and the
// claim is consumed by whichever request makes it. The bar is extra — a failure leaves it out.
let goalRequested = false;
watch(
  [ready, page],
  async ([isReady, current]) => {
    if (!isReady || current === "progress" || goalRequested) return;
    goalRequested = true;
    goal.value = await api.progressGoal().catch(() => null);
  },
  { immediate: true },
);

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
  window.addEventListener("popstate", onPopState);
});

onBeforeUnmount(() => {
  window.removeEventListener("touchstart", onTouchStart);
  window.removeEventListener("touchend", onTouchEnd);
  window.removeEventListener("popstate", onPopState);
});
</script>

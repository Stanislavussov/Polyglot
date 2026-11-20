<template>
  <!-- Phones only: the four things a learner reaches for most, one tap away under the thumb. -->
  <nav
    v-show="!keyboardUp"
    class="fixed inset-x-0 bottom-0 z-30 bg-canvas pb-[env(safe-area-inset-bottom)] md:hidden"
    :aria-label="t('web.nav.quick')"
  >
    <ul class="grid h-16 grid-cols-4 items-center gap-1 px-2">
      <li v-for="item in ITEMS" :key="item.page" class="min-w-0">
        <a
          :href="item.href"
          :aria-current="current === item.page ? 'page' : undefined"
          :class="[
            'flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-sm font-medium tracking-tight transition-colors',
            current === item.page ? 'bg-primary text-primary-fg' : 'text-ink-muted hover:bg-surface hover:text-ink',
          ]"
          @click="onClick($event, item.page)"
        >
          <component :is="item.icon" class="size-5 shrink-0" aria-hidden="true" />
          <span class="max-w-full truncate">{{ t(item.label) }}</span>
        </a>
      </li>
    </ul>
  </nav>
</template>

<script setup lang="ts">
import { BookOpen, GraduationCap, Languages, MessageCircle } from "lucide-vue-next";
import { computed } from "vue";
import { t } from "../lib/i18n";
import { keyboardUp, type QuickTarget, quickTargetFor } from "../lib/mobile-dock";
import type { PageName } from "../lib/types";

const props = defineProps<{ page: PageName }>();
const emit = defineEmits<{ navigate: [page: PageName] }>();

const current = computed(() => quickTargetFor(props.page));

const ITEMS: readonly { page: QuickTarget; href: string; label: string; icon: typeof Languages }[] = [
  { page: "translate", href: "/translate/", label: "web.nav.translate", icon: Languages },
  { page: "dictionary", href: "/dictionary/", label: "web.nav.dictionary", icon: BookOpen },
  { page: "review", href: "/review/", label: "web.nav.review", icon: GraduationCap },
  { page: "mentor", href: "/learn/mentor/", label: "web.learn.mentor", icon: MessageCircle },
];

// A plain tap switches the view in place; modified clicks keep normal link behaviour.
function onClick(event: MouseEvent, target: PageName): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  emit("navigate", target);
}
</script>

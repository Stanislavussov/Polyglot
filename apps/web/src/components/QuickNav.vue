<template>
  <!-- The four things a learner reaches for most, one tap away under the thumb. Icons only: the panel stays quiet. -->
  <nav :aria-label="t('web.nav.quick')">
    <ul class="grid h-14 grid-cols-4 items-center gap-1 px-2">
      <li v-for="item in ITEMS" :key="item.page">
        <a
          :href="item.href"
          :aria-label="t(item.label)"
          :title="t(item.label)"
          :aria-current="current === item.page ? 'page' : undefined"
          :class="[
            'mx-auto grid h-11 w-16 place-items-center rounded-full transition-colors',
            current === item.page ? 'bg-primary text-primary-fg' : 'text-primary-soft-fg hover:bg-surface',
          ]"
          @click="onClick($event, item.page)"
        >
          <component :is="item.icon" class="size-6" aria-hidden="true" />
        </a>
      </li>
    </ul>
  </nav>
</template>

<script setup lang="ts">
import { BookOpen, GraduationCap, Languages, MessageCircle } from "lucide-vue-next";
import { computed } from "vue";
import { t } from "../lib/i18n";
import { type QuickTarget, quickTargetFor } from "../lib/mobile-dock";
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

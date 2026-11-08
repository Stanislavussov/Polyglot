<template>
  <nav class="flex flex-col gap-1 px-3 py-4" :aria-label="'Polyglot'">
    <a
      v-for="item in items"
      :key="item.page"
      :href="item.href"
      :aria-current="item.page === page ? 'page' : undefined"
      @click="onClick($event, item.page)"
      :class="[
        'group flex min-h-11 items-center gap-3 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-semibold transition-colors',
        item.page === page ? 'bg-sidebar-active text-sidebar-fg' : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg',
      ]"
    >
      <span
        :class="[
          'grid size-8 shrink-0 place-items-center rounded-full transition-colors',
          item.page === page ? 'bg-accent text-accent-fg' : 'bg-sidebar-hover',
        ]"
      >
        <component :is="item.icon" class="size-[18px]" aria-hidden="true" />
      </span>
      {{ t(item.label) }}
    </a>
  </nav>
</template>

<script setup lang="ts">
import { BookOpen, GraduationCap, Languages } from "lucide-vue-next";
import { t } from "../lib/i18n";
import type { PageName } from "../lib/types";

defineProps<{ page: PageName }>();
const emit = defineEmits<{ navigate: [page: PageName] }>();

// A plain click switches the view in place; modified clicks (new tab, etc.) keep normal link behaviour.
function onClick(event: MouseEvent, target: PageName): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  emit("navigate", target);
}

const items = [
  { page: "translate", href: "/translate/", label: "web.nav.translate", icon: Languages },
  { page: "dictionary", href: "/dictionary/", label: "web.nav.dictionary", icon: BookOpen },
  { page: "review", href: "/review/", label: "web.nav.review", icon: GraduationCap },
] as const;
</script>

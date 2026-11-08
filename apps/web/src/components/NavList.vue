<template>
  <nav class="flex flex-col gap-1 px-3 py-4" :aria-label="'Polyglot'">
    <a
      v-for="item in items"
      :key="item.page"
      :href="item.href"
      :aria-current="item.page === page ? 'page' : undefined"
      :class="[
        'flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
        item.page === page ? 'bg-sidebar-active text-sidebar-fg' : 'text-sidebar-muted hover:bg-sidebar-hover',
      ]"
    >
      <component :is="item.icon" class="size-5 shrink-0" aria-hidden="true" />
      {{ t(item.label) }}
    </a>
  </nav>
</template>

<script setup lang="ts">
import { BookOpen, GraduationCap, Languages, Settings, TrendingUp } from "lucide-vue-next";
import { t } from "../lib/i18n";
import type { PageName } from "../lib/types";

defineProps<{ page: PageName }>();

const items = [
  { page: "translate", href: "/translate/", label: "web.nav.translate", icon: Languages },
  { page: "dictionary", href: "/dictionary/", label: "web.nav.dictionary", icon: BookOpen },
  { page: "review", href: "/review/", label: "web.nav.review", icon: GraduationCap },
  { page: "progress", href: "/progress/", label: "web.nav.progress", icon: TrendingUp },
  { page: "settings", href: "/settings/", label: "web.nav.settings", icon: Settings },
] as const;
</script>

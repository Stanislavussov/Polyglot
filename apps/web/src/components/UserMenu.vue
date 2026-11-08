<template>
  <div class="border-t border-sidebar-hover p-3">
    <DropdownMenuRoot>
      <DropdownMenuTrigger
        :class="[
          'group flex min-h-12 w-full items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition-colors hover:bg-sidebar-hover data-[state=open]:bg-sidebar-hover',
          active ? 'bg-sidebar-active' : '',
        ]"
      >
        <span class="grid size-9 shrink-0 place-items-center rounded-full bg-accent font-display text-sm font-extrabold text-accent-fg" aria-hidden="true">
          {{ initial }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold text-sidebar-fg">{{ name }}</span>
          <span class="block truncate text-xs text-sidebar-muted">{{ plan }}</span>
        </span>
        <ChevronsUpDown class="size-4 shrink-0 text-sidebar-muted" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent
          side="top"
          align="start"
          :side-offset="8"
          class="z-50 w-[var(--reka-dropdown-menu-trigger-width)] min-w-52 rounded-2xl border border-line bg-surface p-1.5 shadow-soft"
        >
          <DropdownMenuItem :class="menuItem" @select="emit('navigate', 'plan')">
            <Gem class="size-4" aria-hidden="true" />{{ t("web.nav.plan") }}
          </DropdownMenuItem>
          <DropdownMenuItem :class="menuItem" @select="emit('navigate', 'settings')">
            <Settings class="size-4" aria-hidden="true" />{{ t("web.nav.settings") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator class="my-1 h-px bg-line" />
          <DropdownMenuItem :class="menuItem" @select="signOut">
            <LogOut class="size-4" aria-hidden="true" />{{ t("web.nav.signOut") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  </div>
</template>

<script setup lang="ts">
import { ChevronsUpDown, Gem, LogOut, Settings } from "lucide-vue-next";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "reka-ui";
import { computed, onMounted, ref } from "vue";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import type { Me, PageName } from "../lib/types";

defineProps<{ active: boolean }>();
const emit = defineEmits<{ navigate: [page: PageName] }>();

const menuItem =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-medium text-ink outline-none data-[highlighted]:bg-surface-muted";

const me = ref<Me | null>(null);
const name = computed(() => (me.value?.username ? `@${me.value.username}` : "Polyglot"));
const initial = computed(() => (me.value?.username ?? "P").charAt(0).toUpperCase());
const plan = computed(() => {
  const value = me.value?.plan ?? "free";
  return value.charAt(0).toUpperCase() + value.slice(1);
});

onMounted(async () => {
  me.value = await api.me().catch(() => null);
});

async function signOut(): Promise<void> {
  // Even if the call fails the cookie may be gone; the login page re-checks the session either way.
  await api.logout().catch(() => undefined);
  window.location.replace("/login/");
}
</script>

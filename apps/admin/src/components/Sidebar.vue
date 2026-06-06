<template>
  <aside class="flex h-full w-60 flex-col bg-sidebar text-gray-300">
    <div class="flex h-16 items-center gap-2 border-b border-white/10 px-5">
      <span class="text-xl font-bold tracking-tight text-white">Polyglot</span>
      <span class="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
        Admin
      </span>
    </div>
    <nav class="flex-1 space-y-1 px-3 py-4">
      <a
        v-for="item in items"
        :key="item.href"
        :href="item.href"
        :class="[
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          isActive(item.href)
            ? 'bg-sidebar-active text-white'
            : 'text-gray-400 hover:bg-sidebar-hover hover:text-white',
        ]"
      >
        <span v-html="item.icon" />
        {{ item.label }}
      </a>
    </nav>
    <div class="border-t border-white/10 px-3 py-3">
      <button
        class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:bg-sidebar-hover hover:text-white"
        @click="auth.logout"
      >
        <span>🚪</span>
        Sign out
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { auth } from "../lib/api";

const props = defineProps<{
  currentPath: string;
}>();

const items = [
  { href: "/", label: "Dashboard", icon: "📈" },
  { href: "/users", label: "Users", icon: "👥" },
  { href: "/rate-limits", label: "Rate Limits", icon: "⏱️" },
  { href: "/ai-models", label: "AI Models", icon: "🤖" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
  { href: "/presets", label: "Presets", icon: "🎯" },
];

function isActive(href: string): boolean {
  if (href === "/") return props.currentPath === "/";
  return props.currentPath.startsWith(href);
}
</script>

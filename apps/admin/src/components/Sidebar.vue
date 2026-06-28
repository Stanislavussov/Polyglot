<template>
  <aside class="flex w-full shrink-0 flex-col bg-sidebar text-gray-300 md:sticky md:top-0 md:h-screen md:w-60">
    <div class="flex h-14 items-center gap-2 border-b border-white/10 px-4 md:h-16 md:px-5">
      <span class="text-lg font-bold tracking-tight text-white md:text-xl">Polyglot</span>
      <span class="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
        Admin
      </span>
    </div>
    <nav class="flex gap-1 overflow-x-auto px-3 py-3 md:min-h-0 md:flex-1 md:flex-col md:space-y-1 md:overflow-x-hidden md:overflow-y-auto md:py-4">
      <a
        v-for="item in items"
        :key="item.href"
        :href="item.href"
        :class="[
          'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors md:gap-3',
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
  { href: "/request-stats", label: "Request Stats", icon: "📅" },
  { href: "/reported-issues", label: "Reports", icon: "📝" },
  { href: "/rate-limits", label: "Rate Limits", icon: "⏱️" },
  { href: "/ai-models", label: "AI Models", icon: "🤖" },
  { href: "/test-coverage", label: "Test Coverage", icon: "✅" },
  { href: "/architecture", label: "Architecture", icon: "🧭" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
  { href: "/presets", label: "Presets", icon: "🎯" },
];

function isActive(href: string): boolean {
  if (href === "/") return props.currentPath === "/";
  return props.currentPath.startsWith(href);
}
</script>

<template>
  <section>
    <h1 class="page-title">{{ t("web.learn.title") }}</h1>
    <p class="mt-3 text-base text-ink-muted">{{ t("web.learn.subtitle") }}</p>
    <ul class="mt-6 grid gap-3 sm:grid-cols-2">
      <li v-for="mode in modes" :key="mode.href">
        <a :href="mode.href" class="card flex min-h-16 items-center gap-3 text-xl font-semibold hover:bg-surface-muted">
          <span aria-hidden="true">{{ mode.icon }}</span>{{ t(mode.label) }}
        </a>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { t } from "../lib/i18n";

// The bot's hub order (scenes/learn.scene.ts): new words, the drill, the open-ended sources; grammar check last.
const modes = [
  { href: "/learn/pick/", icon: "✨", label: "web.learn.pick" },
  { href: "/review/", icon: "🎴", label: "web.learn.cards" },
  { href: "/learn/videos/", icon: "🎬", label: "web.learn.videos" },
  { href: "/learn/mentor/", icon: "🧑‍🏫", label: "web.learn.mentor" },
  { href: "/learn/expressions/", icon: "💬", label: "web.learn.expressions" },
  { href: "/learn/grammar/", icon: "✍️", label: "web.learn.grammar" },
] as const;
</script>

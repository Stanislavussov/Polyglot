<template>
  <section>
    <h1 class="page-title">{{ t("web.learn.title") }}</h1>
    <p class="mt-3 text-base text-ink-muted">{{ t("web.learn.subtitle") }}</p>
    <ul class="mt-6 grid gap-3 sm:grid-cols-2">
      <li v-for="mode in modes" :key="mode.href">
        <a :href="mode.href" class="card flex min-h-16 items-center text-xl font-semibold hover:bg-surface-muted">
          {{ t(mode.label) }}
        </a>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { t } from "../lib/i18n";

// The bot's hub order (scenes/learn.scene.ts): new words, the drill, the open-ended sources; grammar check last.
const modes = [
  { href: "/learn/pick/", label: "web.learn.pick" },
  { href: "/review/", label: "web.learn.cards" },
  { href: "/learn/videos/", label: "web.learn.videos" },
  { href: "/learn/articles/", label: "web.learn.articles" },
  { href: "/learn/mentor/", label: "web.learn.mentor" },
  { href: "/learn/expressions/", label: "web.learn.expressions" },
  { href: "/learn/grammar/", label: "web.learn.grammar" },
] as const;
</script>

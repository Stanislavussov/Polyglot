<template>
  <section>
    <h1 class="page-title">{{ t("web.learn.title") }}</h1>
    <p class="mt-3 text-base text-ink-muted">{{ t("web.learn.subtitle") }}</p>
    <div v-for="group in groups" :key="group.label" class="mt-8">
      <h2 class="text-sm font-bold uppercase tracking-wide text-ink-muted">{{ t(group.label) }}</h2>
      <ul class="mt-3 grid gap-3 sm:grid-cols-2">
        <li v-for="mode in group.modes" :key="mode.href">
          <a
            :href="mode.href"
            class="card flex h-full items-start gap-4 transition duration-200 hover:-translate-y-0.5 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span class="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary-soft-fg">
              <component :is="mode.icon" class="size-6" aria-hidden="true" />
            </span>
            <span class="min-w-0">
              <span class="block text-xl font-semibold">{{ t(`web.learn.mode.${mode.id}.title`) }}</span>
              <span class="mt-1 block text-base text-ink-muted">{{ t(`web.learn.mode.${mode.id}.desc`) }}</span>
            </span>
          </a>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { CirclePlay, GraduationCap, MessageCircle, Newspaper, Quote, SpellCheck, WandSparkles } from "lucide-vue-next";
import { t } from "../lib/i18n";

// Within each group, the bot's hub order (scenes/learn.scene.ts): new words first, open-ended sources after.
const groups = [
  {
    label: "web.learn.group.discover",
    modes: [
      { id: "pick", href: "/learn/pick/", icon: WandSparkles },
      { id: "expressions", href: "/learn/expressions/", icon: Quote },
      { id: "videos", href: "/learn/videos/", icon: CirclePlay },
      { id: "articles", href: "/learn/articles/", icon: Newspaper },
    ],
  },
  {
    label: "web.learn.group.practice",
    modes: [
      { id: "cards", href: "/review/", icon: GraduationCap },
      { id: "grammar", href: "/learn/grammar/", icon: SpellCheck },
      { id: "mentor", href: "/learn/mentor/", icon: MessageCircle },
    ],
  },
] as const;
</script>

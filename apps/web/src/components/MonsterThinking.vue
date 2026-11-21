<template>
  <!-- The web's wait animation: a monster that sways, squashes and looks around inside a breathing halo, with the
       bot's wait phrase (in the learner's languages) beside it. The phrase has a fixed two-line slot and cross-fades,
       so a new phrase never shifts the card. -->
  <div class="flex items-center gap-4">
    <div class="thinking relative grid size-12 shrink-0 place-items-center" aria-hidden="true">
      <span class="halo absolute inset-0 rounded-full bg-accent" />
      <span v-for="n in 3" :key="n" class="orbit absolute inset-0" :style="{ animationDelay: `${-n * 0.6}s` }">
        <span class="absolute left-1/2 top-0 size-1 -translate-x-1/2 rounded-full bg-primary" />
      </span>
      <svg viewBox="0 0 64 64" class="body relative size-8 text-primary" fill="currentColor">
        <path class="ear ear-left" d="M16 28 L11 7 L32 21 Z" />
        <path class="ear ear-right" d="M48 28 L53 7 L32 21 Z" />
        <path d="M32 14c10.5 0 18.5 7.8 18.5 18.5v5c0 8.3-8.3 14-18.5 14s-18.5-5.7-18.5-14v-5C13.5 21.8 21.5 14 32 14z" />
        <circle cx="24.5" cy="33.5" r="7" fill="var(--color-surface)" />
        <circle cx="39.5" cy="33.5" r="7" fill="var(--color-surface)" />
        <g class="pupils" fill="var(--color-ink)">
          <circle cx="24.5" cy="34" r="3.2" />
          <circle cx="39.5" cy="34" r="3.2" />
        </g>
      </svg>
    </div>
    <div class="relative min-h-[2.75rem] min-w-0 flex-1" role="status">
      <Transition name="phrase">
        <p :key="label" class="absolute inset-x-0 top-1/2 line-clamp-2 -translate-y-1/2 text-sm text-ink-muted">{{ label }}</p>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<style scoped>
.body {
  animation: sway 3s cubic-bezier(0.45, 0, 0.55, 1) infinite;
  transform-origin: 50% 85%;
}

.ear {
  animation: flap 1.2s ease-in-out infinite;
  transform-box: fill-box;
}
.ear-left {
  transform-origin: 100% 100%;
}
.ear-right {
  transform-origin: 0% 100%;
  animation-delay: -0.6s;
}

.pupils {
  animation: look 3.6s ease-in-out infinite;
}

.halo {
  opacity: 0.25;
  animation: breathe 3s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

.orbit {
  animation: orbit 2.4s cubic-bezier(0.6, 0.1, 0.4, 0.9) infinite;
}

@keyframes sway {
  0%, 100% { transform: rotate(-8deg) scale(1, 1); }
  25% { transform: rotate(0deg) scale(1.06, 0.94); }
  50% { transform: rotate(8deg) scale(1, 1); }
  75% { transform: rotate(0deg) scale(0.95, 1.05) translateY(-2px); }
}

@keyframes flap {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-12deg); }
}

@keyframes look {
  0%, 20%, 100% { transform: translate(0, 0); }
  30%, 45% { transform: translate(-2px, -1px); }
  55%, 70% { transform: translate(2px, -1px); }
  80% { transform: translate(0, 1px); }
}

@keyframes breathe {
  0%, 100% { transform: scale(0.75); opacity: 0.15; }
  50% { transform: scale(1); opacity: 0.35; }
}

@keyframes orbit {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.phrase-enter-active,
.phrase-leave-active {
  transition: opacity 400ms ease;
}
.phrase-enter-from,
.phrase-leave-to {
  opacity: 0;
}
</style>

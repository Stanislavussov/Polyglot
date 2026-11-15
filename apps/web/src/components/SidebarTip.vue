<template>
  <TooltipProvider :delay-duration="150">
    <TooltipRoot :disabled="!collapsed">
      <TooltipTrigger as-child><slot /></TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          side="right"
          :side-offset="10"
          class="z-50 whitespace-nowrap rounded-xl bg-ink px-3 py-1.5 text-sm font-semibold text-surface shadow-soft"
        >
          {{ text }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from "reka-ui";

// Labels are visible when the menu is open, so the tooltip only speaks for a folded, icons-only menu.
defineProps<{ text: string; collapsed: boolean }>();
</script>

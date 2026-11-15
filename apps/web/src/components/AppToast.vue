<template>
  <!-- Top of the screen: the bottom belongs to the phone's floating action button. -->
  <div class="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-50 flex justify-center px-4" role="status" aria-live="polite">
    <Transition
      enter-from-class="-translate-y-2 opacity-0"
      leave-to-class="-translate-y-2 opacity-0"
      enter-active-class="transition duration-200"
      leave-active-class="transition duration-200"
    >
      <p v-if="toastMessage" class="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-fg shadow-lg">
        <Check class="size-4" aria-hidden="true" />{{ toastMessage }}
      </p>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { Check } from "lucide-vue-next";
import { toastMessage } from "../lib/toast";
</script>

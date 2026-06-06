<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
      <DialogContent
        :class="
          cn(
            'fixed left-1/2 top-1/2 z-50 mx-4 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:p-6',
            widthClass,
          )
        "
      >
        <DialogTitle v-if="title" class="mb-4 text-lg font-semibold text-gray-900">{{ title }}</DialogTitle>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { cn } from "../../lib/utils";

const props = withDefaults(
  defineProps<{
    size?: "sm" | "md" | "lg";
    open?: boolean;
    title?: string;
  }>(),
  {
    size: "md",
    open: true,
    title: undefined,
  },
);

const emit = defineEmits<{
  close: [];
}>();

const widthClass = computed(() => {
  if (props.size === "sm") return "max-w-sm";
  if (props.size === "lg") return "max-w-lg";
  return "max-w-md";
});

function handleOpenChange(value: boolean): void {
  if (!value) {
    emit("close");
  }
}
</script>

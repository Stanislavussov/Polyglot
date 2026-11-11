<template>
  <DialogRoot :open="open" @update:open="(next) => !next && emit('close')">
    <DialogPortal>
      <DialogOverlay :style="overlayStyle" :class="{ 'sheet-dragged-out': dismissing }" class="sheet-overlay fixed inset-0 z-40 bg-ink opacity-50" />
      <!-- A bottom sheet on phones, a centered panel from sm up. -->
      <DialogContent
        :style="sheetStyle"
        :class="[{ 'sheet-dragged-out': dismissing }, panelClass]"
        class="sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
        :aria-describedby="undefined"
      >
        <!-- Header and footer stay put while long content scrolls between them, so closing is always one tap away.
             On phones the header is also the drag zone: pull it down to dismiss the sheet. -->
        <div
          class="shrink-0 touch-none border-b border-line px-4 pb-3 pt-2 sm:touch-auto sm:px-6 sm:pt-3"
          @touchstart.passive="onDragStart"
          @touchmove.passive="onDragMove"
          @touchend="onDragEnd"
          @touchcancel="onDragEnd"
        >
          <div class="mx-auto mb-2 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
          <div class="flex items-center justify-between gap-3">
            <!-- `header` replaces the title row; it must still render a DialogTitle (sr-only is fine). -->
            <slot name="header"><DialogTitle class="min-w-0 break-words text-xl font-semibold"><slot name="title" /></DialogTitle></slot>
            <DialogClose class="grid size-11 shrink-0 place-items-center rounded-xl hover:bg-surface-muted" :aria-label="t('web.dictionary.close')">
              <X class="size-5" aria-hidden="true" />
            </DialogClose>
          </div>
        </div>
        <!-- Like Telegram: once the content is scrolled to the top, pulling down drags the sheet too. -->
        <div
          ref="body"
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
          @touchstart.passive="onBodyDragStart"
          @touchmove.passive="onDragMove"
          @touchend="onDragEnd"
          @touchcancel="onDragEnd"
        >
          <slot />
        </div>
        <div class="shrink-0 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          <slot name="footer">
            <DialogClose class="btn-secondary w-full py-3 sm:w-auto sm:py-2">{{ t("web.dictionary.close") }}</DialogClose>
          </slot>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { X } from "lucide-vue-next";
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { computed, ref, watch } from "vue";
import { t } from "../lib/i18n";

const props = defineProps<{ open: boolean; panelClass?: string }>();
const emit = defineEmits<{ close: [] }>();

/** How far the sheet must be pulled before letting go closes it. */
const DISMISS_PX = 100;
const dragStartY = ref<number | null>(null);
const dragOffset = ref(0);

/** Set once a pull passes DISMISS_PX: the sheet finishes sliding off screen before it unmounts. */
const dismissing = ref(false);
const SLIDE_OUT_MS = 220;

const sheetStyle = computed(() => {
  if (dismissing.value) return { transform: "translateY(100%)", transition: `transform ${SLIDE_OUT_MS}ms ease-in` };
  if (dragStartY.value !== null && dragOffset.value > 0) {
    return { transform: `translateY(${dragOffset.value}px)`, transition: "none" };
  }
  return undefined;
});

// The dim fades with the sheet: dropping it in one frame while the sheet still slid was the visible flash.
const overlayStyle = computed(() => {
  if (dismissing.value) return { opacity: 0, transition: `opacity ${SLIDE_OUT_MS}ms ease-in` };
  if (dragStartY.value !== null && dragOffset.value > 0) {
    return { opacity: 0.5 * Math.max(0, 1 - dragOffset.value / 400), transition: "none" };
  }
  return undefined;
});

function onDragStart(event: TouchEvent): void {
  // From sm up the panel is centered by a transform that a drag offset would overwrite.
  if (window.matchMedia("(min-width: 640px)").matches) return;
  dragStartY.value = event.touches[0]?.clientY ?? null;
}

const body = ref<HTMLElement | null>(null);

function onBodyDragStart(event: TouchEvent): void {
  if ((body.value?.scrollTop ?? 0) > 0) return;
  onDragStart(event);
}

function onDragMove(event: TouchEvent): void {
  if (dragStartY.value === null) return;
  // Scrolled content: the finger is reading, not dragging the sheet.
  if ((body.value?.scrollTop ?? 0) > 0) {
    dragStartY.value = null;
    dragOffset.value = 0;
    return;
  }
  dragOffset.value = Math.max(0, (event.touches[0]?.clientY ?? dragStartY.value) - dragStartY.value);
}

function onDragEnd(): void {
  const pulled = dragOffset.value;
  dragStartY.value = null;
  dragOffset.value = 0;
  if (pulled <= DISMISS_PX) return; // dropping the inline transform lets the sheet's transition spring it back
  dismissing.value = true;
  // `dismissing` stays set through the close: clearing it here put the sheet back
  // on screen for a frame and replayed the exit animation (a double blink).
  setTimeout(() => emit("close"), SLIDE_OUT_MS);
}

watch(
  () => props.open,
  (open) => {
    if (open) dismissing.value = false;
  },
);
</script>

<style>
/* Not scoped: the dialog is portalled to <body>. Open/close are driven by reka-ui's data-state,
   which keeps the element mounted until the exit animation ends. */
.sheet {
  transition: transform 280ms cubic-bezier(0.32, 0.72, 0, 1);
}
.sheet[data-state="open"] {
  animation: sheet-in 280ms cubic-bezier(0.32, 0.72, 0, 1);
}
.sheet[data-state="closed"] {
  animation: sheet-out 200ms ease-in forwards;
}
/* After a swipe the sheet is already off screen; replaying the exit would flash it back. */
.sheet.sheet-dragged-out[data-state="closed"] {
  animation: none;
}
.sheet-overlay[data-state="open"] {
  animation: overlay-in 240ms ease-out;
}
.sheet-overlay[data-state="closed"] {
  animation: overlay-out 200ms ease-in forwards;
}
.sheet-overlay.sheet-dragged-out[data-state="closed"] {
  animation: none;
  opacity: 0;
}

@keyframes sheet-in {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
@keyframes sheet-out {
  from { transform: translateY(0); }
  to { transform: translateY(100%); }
}
@keyframes overlay-in {
  from { opacity: 0; }
  to { opacity: 0.5; }
}
@keyframes overlay-out {
  from { opacity: 0.5; }
  to { opacity: 0; }
}

/* From sm up the panel is centered by translate(-50%, -50%): fade and lift instead of sliding. */
@media (min-width: 640px) {
  .sheet[data-state="open"] {
    animation: panel-in 200ms ease-out;
  }
  .sheet[data-state="closed"] {
    animation: panel-out 160ms ease-in forwards;
  }
  @keyframes panel-in {
    from { opacity: 0; transform: translate(-50%, -48%) scale(0.98); }
    to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }
  @keyframes panel-out {
    from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    to { opacity: 0; transform: translate(-50%, -48%) scale(0.98); }
  }
}

@media (prefers-reduced-motion: reduce) {
  .sheet,
  .sheet-overlay {
    animation: none !important;
    transition: none !important;
  }
}
</style>

<template>
  <!-- The one text box pattern, shaped like a chat app's: translate, asking about a word, the mentor and the
       grammar check share it, so typing feels the same everywhere. Phones move it into the shell's bottom panel
       (MobileDock), within thumb reach and over the keyboard; wider screens keep it in the page. -->
  <Teleport :to="DOCK_TARGET" defer :disabled="!docked">
  <form v-bind="$attrs" @submit.prevent="send">
    <!-- Errors and questions about what was typed sit right by the box, so a phone never hides them up the page. -->
    <div v-if="docked" class="mb-2 max-h-[45dvh] space-y-2 overflow-y-auto empty:hidden" aria-live="polite"><slot name="notice" /></div>
    <div
      class="rounded-3xl border border-line bg-surface p-3 transition-colors focus-within:border-ring md:shadow-card"
      @click="focusField"
    >
      <label class="sr-only" :for="id">{{ placeholder }}</label>
      <textarea
        :id="id"
        ref="el"
        :value="modelValue"
        class="block max-h-[40dvh] min-h-11 w-full resize-none bg-transparent px-2 py-2 text-base text-ink placeholder:text-ink-muted focus:outline-none md:min-h-20"
        rows="1"
        :maxlength="maxLength"
        :placeholder="placeholder"
        @input="onInput"
        @keydown="onKeydown"
        @focus="composerFocused = true"
        @blur="composerFocused = false"
      />
      <div class="flex items-center gap-2">
        <slot name="tools" />
        <button
          v-if="modelValue !== ''"
          type="button"
          class="grid size-11 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          :aria-label="t('web.translate.clear')"
          :title="t('web.translate.clear')"
          @mousedown.prevent
          @click="clear"
        >
          <X class="size-5" aria-hidden="true" />
        </button>
        <span v-if="nearLimit" class="text-sm text-ink-muted" aria-hidden="true">{{ modelValue.length }}/{{ maxLength }}</span>
        <!-- mousedown.prevent: a tap must not pull focus off the text box — the button turns disabled while busy,
             the browser then drops focus to <body>, and on phones the keyboard would fold mid-answer. -->
        <button
          type="submit"
          class="ml-auto grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-fg shadow-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-primary-soft disabled:text-primary-soft-fg disabled:shadow-none"
          :aria-label="busy ? t('web.translate.working') : submitLabel"
          :title="busy ? t('web.translate.working') : submitLabel"
          :disabled="busy || modelValue.trim() === ''"
          @mousedown.prevent
        >
          <LoaderCircle v-if="busy" class="size-5 animate-spin" aria-hidden="true" />
          <ArrowUp v-else class="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>
    <slot />
    <div v-if="!docked" class="mt-4 space-y-2 empty:hidden" aria-live="polite"><slot name="notice" /></div>
  </form>
  </Teleport>
</template>

<script setup lang="ts">
import { ArrowUp, LoaderCircle, X } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import { t } from "../lib/i18n";
import { composerFocused, DOCK_TARGET, useDocked } from "../lib/mobile-dock";

const props = defineProps<{
  id: string;
  modelValue: string;
  placeholder: string;
  submitLabel: string;
  maxLength: number;
  busy: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string]; submit: [] }>();

const el = useTemplateRef<HTMLTextAreaElement>("el");
// Teleport is the root, so the page's classes go onto the form by hand.
defineOptions({ inheritAttrs: false });
const docked = useDocked();
defineExpose({ el });

// The counter only matters once the limit is in sight.
const nearLimit = computed(() => props.modelValue.length >= props.maxLength * 0.8);

function send(): void {
  if (!props.busy && props.modelValue.trim() !== "") emit("submit");
}

function clear(): void {
  emit("update:modelValue", "");
  el.value?.focus();
}

function focusField(event: MouseEvent): void {
  if (event.target === event.currentTarget) el.value?.focus();
}

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}

// The box grows with the text up to its max height, then scrolls — like a chat app's.
function fit(): void {
  const field = el.value;
  if (!field) return;
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}
watch(
  () => props.modelValue,
  () => void nextTick(fit),
);

// Enter sends, Shift+Enter breaks the line, Escape clears.
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    clear();
  } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}

onMounted(fit);
onBeforeUnmount(() => {
  composerFocused.value = false;
});
</script>

<template>
  <!-- The one text box pattern, a roomy field as in DeepL, with its tools in a row under the text: translate, asking about a word, the mentor and the
       grammar check share it, so typing feels the same everywhere. It sits in the page flow (top, or under the mentor chat),
       never docked: nothing has to follow the phone keyboard, so nothing breaks when a browser misreports it. -->
  <form @submit.prevent="send">
    <div
      class="rounded-3xl border border-line bg-surface p-3 transition-colors focus-within:border-ring shadow-card"
      @click="focusField"
    >
      <label class="sr-only" :for="id">{{ placeholder }}</label>
      <!-- While a voice note is recorded or read, the page's wave takes the text's place; the box keeps its height. -->
      <div v-if="voice" class="flex min-h-32 items-center px-2 py-2 md:min-h-20"><slot name="voice" /></div>
      <textarea
        v-show="!voice"
        :id="id"
        ref="el"
        :value="modelValue"
        class="block max-h-[40dvh] min-h-32 w-full resize-none bg-transparent px-2 py-2.5 text-base text-ink placeholder:text-ink-muted focus:outline-none md:min-h-20"
        rows="1"
        :maxlength="maxLength"
        :placeholder="placeholder"
        @input="onInput"
        @keydown="onKeydown"
      />
      <div class="flex items-center gap-2">
        <slot name="tools" />
        <button
          v-if="modelValue !== '' && !voice"
          type="button"
          class="grid size-11 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          :aria-label="t('web.translate.clear')"
          :title="t('web.translate.clear')"
          @mousedown.prevent
          @click="clear"
        >
          <X class="size-5" aria-hidden="true" />
        </button>
        <!-- Always in view, as in DeepL: the learner sees the room left before the limit cuts the text. -->
        <span class="ml-auto text-sm tabular-nums text-ink-muted" aria-hidden="true">{{ modelValue.length }} / {{ maxLength }}</span>
        <!-- mousedown.prevent: a tap must not pull focus off the text box — the button turns disabled while busy,
             the browser then drops focus to <body>, and on phones the keyboard would fold mid-answer. -->
        <button
          type="submit"
          class="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-fg shadow-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-primary-soft disabled:text-primary-soft-fg disabled:shadow-none"
          :aria-label="working ? t('web.translate.working') : submitLabel"
          :title="working ? t('web.translate.working') : submitLabel"
          :disabled="!canSend"
          @mousedown.prevent
        >
          <LoaderCircle v-if="working" class="size-5 animate-spin" aria-hidden="true" />
          <ArrowUp v-else class="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>
    <slot />
    <!-- Errors and questions about what was typed sit right by the box. -->
    <div class="mt-4 space-y-2 empty:hidden" aria-live="polite"><slot name="notice" /></div>
  </form>
</template>

<script setup lang="ts">
import { ArrowUp, LoaderCircle, X } from "lucide-vue-next";
import { computed, nextTick, onMounted, useTemplateRef, watch } from "vue";
import { t } from "../lib/i18n";

const props = defineProps<{
  id: string;
  modelValue: string;
  placeholder: string;
  submitLabel: string;
  maxLength: number;
  busy: boolean;
  /** A voice note in progress: "recording" makes the send button stop and send it at once. */
  voice?: "recording" | "processing" | null;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string]; submit: []; voiceSend: [] }>();

const el = useTemplateRef<HTMLTextAreaElement>("el");
defineExpose({ el });


const working = computed(() => props.busy || props.voice === "processing");
const canSend = computed(() => props.voice === "recording" || (!working.value && props.modelValue.trim() !== ""));

function send(): void {
  if (props.voice === "recording") emit("voiceSend");
  else if (canSend.value) emit("submit");
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
</script>

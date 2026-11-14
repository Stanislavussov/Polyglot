<template>
  <!-- The one text box pattern: translate and the mentor share it, so typing feels the same everywhere. -->
  <form class="card space-y-3" @submit.prevent="send">
    <label class="sr-only" :for="id">{{ placeholder }}</label>
    <textarea
      :id="id"
      ref="el"
      :value="modelValue"
      class="field min-h-28 resize-y focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-ring"
      rows="3"
      :maxlength="maxLength"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      @keydown="onKeydown"
    />
    <div class="flex items-center justify-between gap-3">
      <span class="text-sm text-ink-muted" aria-hidden="true">{{ modelValue.length }}/{{ maxLength }}</span>
      <div class="flex gap-2">
        <slot name="tools" />
        <button v-if="modelValue !== ''" type="button" class="btn-secondary" @click="clear">
          {{ t("web.translate.clear") }}
        </button>
        <!-- On phones the button sits at the bottom of the screen, within thumb reach and above the keyboard. -->
        <button
          type="submit"
          class="btn-primary fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 py-3 shadow-lg md:static md:inset-auto md:py-2 md:shadow-none"
          :disabled="busy || modelValue.trim() === ''"
        >
          {{ busy ? t("web.translate.working") : submitLabel }}
          <span v-if="!busy" class="btn-chip" aria-hidden="true"><ArrowRight class="size-4" /></span>
        </button>
      </div>
    </div>
    <slot />
  </form>
</template>

<script setup lang="ts">
import { ArrowRight } from "lucide-vue-next";
import { useTemplateRef } from "vue";
import { t } from "../lib/i18n";

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
defineExpose({ el });

function send(): void {
  if (!props.busy && props.modelValue.trim() !== "") emit("submit");
}

function clear(): void {
  emit("update:modelValue", "");
  el.value?.focus();
}

// Enter sends, Shift+Enter breaks the line, Escape clears.
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    clear();
  } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}
</script>

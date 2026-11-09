<template>
  <SelectRoot :model-value="modelValue" :disabled="disabled" @update:model-value="onPick">
    <SelectTrigger
      :id="id"
      class="field flex items-center justify-between gap-3 text-left focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-ring data-[placeholder]:text-ink-muted data-[disabled]:opacity-60"
    >
      <span class="flex min-w-0 items-center gap-2.5">
        <LangFlag v-if="selected?.lang" :code="selected.lang" />
        <span class="truncate">{{ selected?.label ?? placeholder }}</span>
      </span>
      <ChevronDown class="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="6"
        :collision-padding="16"
        class="select-content z-50 max-h-[min(22rem,var(--reka-select-content-available-height))] w-[var(--reka-select-trigger-width)] overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-xl"
      >
        <SelectViewport>
          <SelectItem
            v-for="option in options"
            :key="String(option.value)"
            :value="option.value"
            class="flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 text-base outline-none data-[highlighted]:bg-surface-muted data-[state=checked]:font-semibold"
          >
            <LangFlag v-if="option.lang" :code="option.lang" />
            <SelectItemText class="min-w-0 flex-1 truncate">{{ option.label }}</SelectItemText>
            <SelectItemIndicator><Check class="size-4 text-primary" aria-hidden="true" /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<script setup lang="ts" generic="T extends string | number">
import { Check, ChevronDown } from "lucide-vue-next";
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectViewport,
} from "reka-ui";
import { computed } from "vue";
import LangFlag from "./LangFlag.vue";

interface SelectOption<V> {
  value: V;
  label: string;
  /** Language code: shows that language's flag before the label. */
  lang?: string;
}

const props = defineProps<{
  modelValue: T | undefined;
  options: SelectOption<T>[];
  id?: string;
  disabled?: boolean;
  placeholder?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: T] }>();

const selected = computed(() => props.options.find((option) => option.value === props.modelValue));

function onPick(value: unknown): void {
  const match = props.options.find((option) => option.value === value);
  if (match) emit("update:modelValue", match.value);
}
</script>

<style>
/* Not scoped: the list is portalled to <body>. */
.select-content[data-state="open"] {
  animation: select-in 140ms ease-out;
}
@keyframes select-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .select-content { animation: none !important; }
}
</style>

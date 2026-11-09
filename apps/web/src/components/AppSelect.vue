<template>
  <SelectRoot :model-value="modelValue" :disabled="disabled" @update:model-value="onChange">
    <SelectTrigger
      :id="id"
      class="field flex items-center justify-between gap-2 text-left focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-ring data-[disabled]:opacity-60"
    >
      <SelectValue :placeholder="placeholder" class="min-w-0 truncate" />
      <ChevronDown class="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
    </SelectTrigger>
    <SelectPortal>
      <!-- popper keeps the list under the trigger at the trigger's width; on a phone it stays inside the screen. -->
      <SelectContent
        position="popper"
        :side-offset="6"
        :collision-padding="16"
        class="select-content z-50 max-h-[min(var(--reka-select-content-available-height),20rem)] w-[var(--reka-select-trigger-width)] min-w-48 overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
      >
        <SelectViewport class="p-1">
          <SelectItem
            v-for="option in options"
            :key="option.value"
            :value="option.value"
            class="relative flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-lg py-2 pl-3 pr-9 text-base text-ink outline-none data-[highlighted]:bg-surface-muted data-[state=checked]:font-semibold"
          >
            <SelectItemText>{{ option.label }}</SelectItemText>
            <SelectItemIndicator class="absolute right-3 inline-flex items-center text-primary">
              <Check class="size-4" aria-hidden="true" />
            </SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<script setup lang="ts">
import { Check, ChevronDown } from "lucide-vue-next";
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";

defineProps<{
  modelValue: string;
  options: readonly { value: string; label: string }[];
  id?: string;
  placeholder?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

function onChange(value: unknown): void {
  if (typeof value === "string") emit("update:modelValue", value);
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

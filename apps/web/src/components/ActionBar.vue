<template>
  <div ref="bar" class="relative flex min-w-0 flex-1 items-center gap-2">
    <!-- Invisible copy of every button: its widths decide how many fit in the row. -->
    <div ref="ruler" class="pointer-events-none invisible absolute left-0 top-0 flex gap-2" aria-hidden="true">
      <span v-for="action in actions" :key="action.key" :class="BTN"><component :is="action.icon" class="size-5 lg:size-4" /><span class="hidden lg:inline">{{ action.label }}</span></span>
      <span :class="BTN"><Ellipsis class="size-5" /></span>
    </div>

    <template v-for="action in inline" :key="action.key">
      <DropdownMenuRoot v-if="action.children">
        <DropdownMenuTrigger :class="[BTN, action.danger && '!text-danger']" :aria-label="action.label" :title="action.label">
          <component :is="action.icon" class="size-5 lg:size-4" aria-hidden="true" /><span class="hidden lg:inline">{{ action.label }}</span>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent align="start" :side-offset="6" :class="MENU">
            <ActionMenuItem v-for="child in action.children" :key="child.key" :action="child" />
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
      <component
        :is="action.href ? 'a' : 'button'"
        v-else
        :type="action.href ? undefined : 'button'"
        :href="action.href"
        :class="[BTN, action.danger && '!text-danger']"
        :aria-label="action.label"
        :title="action.label"
        @click="action.onSelect?.()"
      >
        <component :is="action.icon" class="size-5 lg:size-4" aria-hidden="true" /><span class="hidden lg:inline">{{ action.label }}</span>
      </component>
    </template>

    <DropdownMenuRoot v-if="overflow.length > 0">
      <DropdownMenuTrigger :class="BTN" :aria-label="t('web.dictionary.more')" :title="t('web.dictionary.more')">
        <Ellipsis class="size-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent align="start" :side-offset="6" :class="MENU">
          <ActionMenuItem v-for="action in overflow" :key="action.key" :action="action" />
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  </div>
</template>

<script setup lang="ts">
import { Ellipsis } from "lucide-vue-next";
import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from "reka-ui";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { type BarAction, MENU } from "../lib/action-bar";
import { t } from "../lib/i18n";
import ActionMenuItem from "./ActionMenuItem.vue";

const props = defineProps<{ actions: BarAction[] }>();

const BTN = "btn-secondary shrink-0 !px-3";

const bar = useTemplateRef<HTMLElement>("bar");
const ruler = useTemplateRef<HTMLElement>("ruler");
const fitCount = ref(props.actions.length);

const inline = computed(() => props.actions.slice(0, fitCount.value));
const overflow = computed(() => props.actions.slice(fitCount.value));

// How many actions stay in the row. The menu never holds a single action: one
// leftover either fits in place of the ⋯ button or takes a second one with it.
function measure(): void {
  const row = bar.value;
  const items = ruler.value ? [...ruler.value.children].map((el) => (el as HTMLElement).offsetWidth) : [];
  if (!row || items.length === 0) return;
  const gap = 8;
  const more = items.pop() ?? 0;
  const room = row.clientWidth;
  const widthOf = (n: number) => items.slice(0, n).reduce((sum, w) => sum + w + gap, 0);
  const total = items.length;
  if (widthOf(total) - gap <= room) {
    fitCount.value = total;
    return;
  }
  let n = total;
  while (n > 0 && widthOf(n) + more > room) n--;
  if (total - n < 2) n = Math.max(0, total - 2);
  fitCount.value = n;
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(() => measure());
  if (bar.value) observer.observe(bar.value);
  measure();
});
onBeforeUnmount(() => observer?.disconnect());
watch(
  () => props.actions.map((action) => `${action.key}:${action.label}`).join("|"),
  () => void nextTick(measure),
);
</script>

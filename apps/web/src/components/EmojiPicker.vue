<template>
  <div class="w-[min(22rem,calc(100vw-2rem))] space-y-3">
    <div class="flex items-center gap-2">
      <div class="relative min-w-0 flex-1">
        <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input v-model="query" type="search" class="field min-h-10 pl-9 text-sm" :placeholder="t('web.dictionaries.iconSearch')" />
      </div>
      <button v-if="modelValue" type="button" class="btn-secondary min-h-10 !px-3 text-sm" @click="emit('update:modelValue', null)">
        {{ t("web.dictionaries.iconRemove") }}
      </button>
    </div>
    <nav v-if="!query.trim()" class="flex justify-between border-b border-line pb-2">
      <button
        v-for="group in GROUPS"
        :key="group.key"
        type="button"
        class="grid size-7 place-items-center rounded-lg text-base hover:bg-surface-muted"
        :title="t(`web.dictionaries.iconGroup.${group.key}`)"
        :aria-label="t(`web.dictionaries.iconGroup.${group.key}`)"
        @click="jump(group.key)"
      >
        {{ group.items[0]?.emoji }}
      </button>
    </nav>
    <div ref="scroller" class="max-h-72 space-y-3 overflow-y-auto overscroll-contain pr-1">
      <section v-for="group in shown" :key="group.key" :data-group="group.key">
        <h4 class="mb-1 text-sm text-ink-muted">{{ t(`web.dictionaries.iconGroup.${group.key}`) }}</h4>
        <div class="grid grid-cols-8 gap-1">
          <button
            v-for="item in group.items"
            :key="item.emoji"
            type="button"
            :class="[
              'grid aspect-square place-items-center rounded-lg text-2xl transition-colors hover:bg-surface-muted',
              item.emoji === modelValue && 'bg-primary-soft',
            ]"
            :aria-label="item.emoji"
            @click="emit('update:modelValue', item.emoji)"
          >
            {{ item.emoji }}
          </button>
        </div>
      </section>
      <p v-if="shown.length === 0" class="py-6 text-center text-sm text-ink-muted">{{ t("web.dictionaries.iconNone") }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Search } from "lucide-vue-next";
import { computed, ref } from "vue";
import { EMOJI_GROUPS as GROUPS } from "../lib/emoji-set";
import { t } from "../lib/i18n";

defineProps<{ modelValue: string | null }>();
const emit = defineEmits<{ "update:modelValue": [icon: string | null] }>();

const query = ref("");
const scroller = ref<HTMLElement | null>(null);

function jump(key: string): void {
  const section = scroller.value?.querySelector<HTMLElement>(`[data-group="${key}"]`);
  if (scroller.value && section) scroller.value.scrollTo({ top: section.offsetTop - scroller.value.offsetTop, behavior: "smooth" });
}
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return GROUPS;
  return GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => item.words.includes(q)) })).filter(
    (group) => group.items.length > 0,
  );
});
</script>

<template>
  <li class="card !p-4">
    <div v-if="removed" class="flex flex-wrap items-center justify-between gap-3 text-sm" role="status">
      <span class="min-w-0 break-words text-ink-muted">{{ t("web.dictionary.removed", { word: item.original }) }}</span>
      <button type="button" class="btn-secondary" :disabled="busy" @click="emit('undo')">
        <Undo2 class="size-4" aria-hidden="true" />{{ t("web.dictionary.undo") }}
      </button>
    </div>

    <template v-else>
      <div class="flex items-start justify-between gap-2">
        <p class="min-w-0 break-words font-semibold">
          <span v-if="item.emoji" class="mr-2" aria-hidden="true">{{ item.emoji }}</span>{{ item.original }}
          <span class="ml-1 text-xs font-normal text-ink-muted">{{ languageFlag(item.sourceLang) }} {{ languageName(item.sourceLang) }}</span>
        </p>
        <button
          type="button"
          class="-mr-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-muted hover:text-ink"
          :title="t('web.dictionary.details')"
          :aria-label="t('web.dictionary.details')"
          @click="emit('details')"
        >
          <Maximize2 class="size-4" aria-hidden="true" />
        </button>
      </div>
      <ul class="mt-2 space-y-1 text-sm">
        <li v-for="translation in ordered" :key="translation.lang" class="break-words">
          <span class="text-ink-muted">{{ languageFlag(translation.lang) }}</span> {{ translation.text }}
        </li>
      </ul>

      <div class="mt-3 flex items-center gap-2">
        <button type="button" class="btn-secondary flex-1 sm:flex-none" @click="emit('details')">
          <Info class="size-4" aria-hidden="true" />{{ t("web.dictionary.details") }}
        </button>

        <!-- Phones keep one primary action and fold the rest into a menu, so the row never overflows. -->
        <DropdownMenuRoot>
          <DropdownMenuTrigger class="btn-secondary !px-3 sm:hidden" :aria-label="t('web.dictionary.more')">
            <Ellipsis class="size-5" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent align="end" :side-offset="6" class="z-50 min-w-44 rounded-xl border border-line bg-surface p-1 shadow-lg">
              <DropdownMenuItem :class="menuItem" @select="emit('copy')">
                <Check v-if="copied" class="size-4" aria-hidden="true" /><Copy v-else class="size-4" aria-hidden="true" />
                {{ copied ? t("web.dictionary.copied") : t("web.dictionary.copy") }}
              </DropdownMenuItem>
              <DropdownMenuItem :class="menuItem" @select="emit('review')">
                <RotateCw class="size-4" aria-hidden="true" />{{ t("web.dictionary.review") }}
              </DropdownMenuItem>
              <DropdownMenuItem :class="[menuItem, 'text-danger']" @select="emit('remove')">
                <Trash2 class="size-4" aria-hidden="true" />{{ t("web.dictionary.remove") }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>

        <div class="hidden items-center gap-2 sm:flex">
          <button type="button" class="btn-secondary" :title="t('web.dictionary.copy')" :aria-label="t('web.dictionary.copy')" @click="emit('copy')">
            <Check v-if="copied" class="size-4" aria-hidden="true" /><Copy v-else class="size-4" aria-hidden="true" />
            <span class="hidden lg:inline">{{ copied ? t("web.dictionary.copied") : t("web.dictionary.copy") }}</span>
          </button>
          <button type="button" class="btn-secondary" :title="t('web.dictionary.review')" :aria-label="t('web.dictionary.review')" @click="emit('review')">
            <RotateCw class="size-4" aria-hidden="true" />
            <span class="hidden lg:inline">{{ t("web.dictionary.review") }}</span>
          </button>
          <button type="button" class="btn-secondary !text-danger" :title="t('web.dictionary.remove')" :aria-label="t('web.dictionary.remove')" @click="emit('remove')">
            <Trash2 class="size-4" aria-hidden="true" />
            <span class="hidden lg:inline">{{ t("web.dictionary.remove") }}</span>
          </button>
        </div>
      </div>
    </template>
  </li>
</template>

<script setup lang="ts">
import { Check, Copy, Ellipsis, Info, Maximize2, RotateCw, Trash2, Undo2 } from "lucide-vue-next";
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from "reka-ui";
import { computed } from "vue";
import { splitNative } from "../lib/card-order";
import { t } from "../lib/i18n";
import { languageFlag, languageName, settings } from "../lib/settings-store";
import type { DictionaryItem } from "../lib/types";

const props = defineProps<{ item: DictionaryItem; removed: boolean; copied: boolean; busy: boolean }>();

const ordered = computed(() => {
  const { native, others } = splitNative(props.item.translations, settings.value?.nativeLang);
  return native ? [native, ...others] : others;
});
const emit = defineEmits<{ details: []; remove: []; undo: []; copy: []; review: [] }>();

const menuItem =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium outline-none data-[highlighted]:bg-surface-muted";
</script>

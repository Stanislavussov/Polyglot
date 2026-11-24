<template>
  <button v-if="saved" type="button" :class="[BASE, 'btn-secondary']" disabled :title="t('web.common.saved')" :aria-label="t('web.common.saved')">
    <BookmarkCheck class="size-4" stroke-width="2.5" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.common.saved") }}</span>
  </button>
  <!-- Icon-only on a phone, so the word next to it keeps the full width. -->
  <button v-else type="button" :class="[BASE, 'btn-primary']" :title="label ?? t('web.translate.save')" :aria-label="label ?? t('web.translate.save')">
    <BookmarkPlus class="size-4" stroke-width="2.5" aria-hidden="true" /><span class="hidden sm:inline">{{ t("web.translate.save") }}</span>
  </button>
</template>

<script setup lang="ts">
import { BookmarkCheck, BookmarkPlus } from "lucide-vue-next";
import { t } from "../lib/i18n";

/** `label`: the accessible name when pressing it means something else, such as undoing a removal. */
defineProps<{ saved?: boolean; label?: string }>();

const BASE = "!min-h-9 min-w-9 gap-1.5 !px-2 !text-sm sm:!px-3";
</script>

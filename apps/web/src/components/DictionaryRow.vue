<template>
  <li v-if="removed" class="card !p-4">
    <div class="flex flex-wrap items-center justify-between gap-3 text-sm" role="status">
      <span class="min-w-0 break-words text-ink-muted">{{ t("web.dictionary.removed", { word: item.original }) }}</span>
      <button type="button" class="btn-secondary" :disabled="busy" @click="emit('undo')">
        <Undo2 class="size-4" aria-hidden="true" />{{ t("web.dictionary.undo") }}
      </button>
    </div>
  </li>

  <WordCard v-else as="li" padding="md">
    <div class="flex items-center gap-2">
      <LangBadge :code="item.sourceLang" />
      <!-- Sound sits by the language: you want to hear the word while reading it. -->
      <SpeakButton
        v-if="audio !== 'off' && item.speakLangs.includes(item.sourceLang)"
        :entry-id="item.id"
        :lang="item.sourceLang"
        :text="item.original"
        :access="audio"
        @notice="(key) => emit('notice', key)"
      />
    </div>
    <WordHeadline class="pt-2" :size="headlineSizeFor(item.original)" :text="item.original" :emoji="item.emoji" />

    <template #body>
      <hr class="border-line" />
      <TranslationLines :lines="ordered" />
    </template>

    <!-- Right-handed thumb zone: the one primary action sits bottom-right, rarer ones to its left. -->
    <template #footer>
      <div class="flex items-center gap-2">
        <ActionBar :actions="actions" />
        <button type="button" class="btn-primary shrink-0" @click="emit('details')">
          <BookOpen class="size-5" aria-hidden="true" />{{ t("web.dictionary.open") }}
        </button>
      </div>
    </template>
  </WordCard>
</template>

<script setup lang="ts">
import { BookOpen, Check, Copy, FolderInput, FolderPlus, History, MessageCircleQuestion, MessagesSquare, Target, Trash2, Undo2 } from "lucide-vue-next";
import { computed } from "vue";
import type { BarAction } from "../lib/action-bar";
import { splitNative } from "../lib/card-order";
import { t } from "../lib/i18n";
import { settings } from "../lib/settings-store";
import type { AudioAccess, Dictionary, DictionaryItem } from "../lib/types";
import { headlineSizeFor } from "../lib/word-card";
import ActionBar from "./ActionBar.vue";
import type { ExploreStart } from "./CardExplore.vue";
import LangBadge from "./LangBadge.vue";
import SpeakButton from "./SpeakButton.vue";
import TranslationLines from "./word/TranslationLines.vue";
import WordCard from "./word/WordCard.vue";
import WordHeadline from "./word/WordHeadline.vue";

const props = defineProps<{
  item: DictionaryItem;
  removed: boolean;
  copied: boolean;
  busy: boolean;
  others: Dictionary[];
  audio: AudioAccess;
}>();
const emit = defineEmits<{ details: []; remove: []; undo: []; copy: []; place: [to: number, move: boolean]; notice: [key: string] }>();

const ordered = computed(() => {
  const { native, others } = splitNative(props.item.translations, settings.value?.nativeLang);
  return native ? [native, ...others] : others;
});

// Etymology is offered for single words only, as on the translate card.
const singleWord = computed(() => !/\s/.test(props.item.original.trim()));

function askHref(start: ExploreStart): string {
  return `/translate/?${new URLSearchParams({ q: props.item.original, explore: start })}`;
}

// Order = priority: the row keeps the first ones, the rest fold into ⋯.
const actions = computed<BarAction[]>(() => [
  ...(props.others.length > 0
    ? [
        {
          key: "place",
          label: t("web.dictionaries.toOther"),
          icon: FolderInput,
          children: props.others.flatMap((other) => [
            { key: `add-${other.id}`, label: t("web.dictionaries.addTo", { name: other.name }), icon: FolderPlus, onSelect: () => emit("place", other.id, false) },
            { key: `move-${other.id}`, label: t("web.dictionaries.moveTo", { name: other.name }), icon: FolderInput, onSelect: () => emit("place", other.id, true) },
          ]),
        },
      ]
    : []),
  {
    key: "ask",
    label: t("web.dictionary.ask"),
    icon: MessageCircleQuestion,
    children: [
      { key: "mentor", label: t("web.dictionary.askMentor"), icon: MessagesSquare, href: askHref("mentor") },
      { key: "clarify", label: t("web.dictionary.askClarify"), icon: Target, href: askHref("clarify") },
      ...(singleWord.value ? [{ key: "etymology", label: t("web.dictionary.askEtymology"), icon: History, href: askHref("etymology") }] : []),
    ],
  },
  {
    key: "copy",
    label: props.copied ? t("web.dictionary.copied") : t("web.dictionary.copy"),
    icon: props.copied ? Check : Copy,
    onSelect: () => emit("copy"),
  },
  { key: "remove", label: t("web.dictionary.remove"), icon: Trash2, danger: true, onSelect: () => emit("remove") },
]);
</script>

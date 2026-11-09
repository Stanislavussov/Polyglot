<template>
  <div class="w-[min(20rem,calc(100vw-2rem))] space-y-3">
    <div class="flex items-center gap-2">
      <div class="relative min-w-0 flex-1">
        <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input v-model="query" type="search" class="field min-h-10 pl-9 text-sm" :placeholder="t('web.dictionaries.iconSearch')" />
      </div>
      <button v-if="modelValue" type="button" class="btn-secondary min-h-10 !px-3 text-sm" @click="emit('update:modelValue', null)">
        {{ t("web.dictionaries.iconRemove") }}
      </button>
    </div>
    <div class="max-h-64 space-y-3 overflow-y-auto overscroll-contain pr-1">
      <section v-for="group in shown" :key="group.key">
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
import { t } from "../lib/i18n";

defineProps<{ modelValue: string | null }>();
const emit = defineEmits<{ "update:modelValue": [icon: string | null] }>();

// A curated set for word lists, with English and Russian search words; a full Unicode
// catalogue would weigh far more than this page and bury the useful picks.
const RAW: { key: string; items: [emoji: string, words: string][] }[] = [
  {
    key: "study",
    items: [
      ["📚", "books study книги учеба"], ["📖", "book read книга"], ["📝", "note write заметка"], ["✏️", "pencil карандаш"],
      ["🎓", "school graduate учеба"], ["🧠", "brain memory мозг память"], ["💡", "idea идея"], ["🔤", "letters abc буквы"],
      ["🗣️", "speak talk говорить"], ["💬", "chat phrase фраза"], ["🎯", "goal target цель"], ["⭐", "star favorite избранное"],
      ["🔥", "fire hot важное"], ["✅", "done check готово"], ["❓", "question вопрос"], ["📌", "pin закреп"],
    ],
  },
  {
    key: "travel",
    items: [
      ["✈️", "plane travel самолет путешествие"], ["🧳", "luggage trip багаж"], ["🗺️", "map карта"], ["🏖️", "beach пляж"],
      ["🏔️", "mountain горы"], ["🚆", "train поезд"], ["🚗", "car машина"], ["🏨", "hotel отель"],
      ["🌍", "world europe мир"], ["🏛️", "museum музей"], ["⛺", "camping кемпинг"], ["🛂", "passport паспорт"],
    ],
  },
  {
    key: "life",
    items: [
      ["🏠", "home дом"], ["💼", "work job работа"], ["💻", "computer it компьютер"], ["🛒", "shopping покупки"],
      ["🍳", "cooking кухня"], ["🍕", "food еда"], ["☕", "coffee кофе"], ["🍷", "wine вино"],
      ["⚽", "sport football спорт"], ["🏋️", "gym спортзал"], ["🎵", "music музыка"], ["🎬", "movie кино"],
      ["🎮", "game игры"], ["🩺", "doctor health врач"], ["💰", "money деньги"], ["❤️", "love любовь"],
    ],
  },
  {
    key: "nature",
    items: [
      ["🌱", "plant growth растение"], ["🌸", "flower цветок"], ["🌳", "tree дерево"], ["🍂", "autumn осень"],
      ["☀️", "sun summer солнце"], ["❄️", "winter snow зима"], ["🌊", "sea море"], ["🌙", "moon night луна"],
      ["🐶", "dog animal собака"], ["🐱", "cat кошка"], ["🦊", "fox лиса"], ["🐝", "bee пчела"],
    ],
  },
  {
    key: "symbols",
    items: [
      ["🟢", "green зеленый"], ["🔵", "blue синий"], ["🟣", "purple фиолетовый"], ["🟡", "yellow желтый"],
      ["🟠", "orange оранжевый"], ["🔴", "red красный"], ["⚪", "white белый"], ["⚫", "black черный"],
      ["💎", "gem diamond алмаз"], ["🚀", "rocket ракета"], ["🧩", "puzzle пазл"], ["🎨", "art искусство"],
    ],
  },
];
const GROUPS = RAW.map((group) => ({ key: group.key, items: group.items.map(([emoji, words]) => ({ emoji, words })) }));

const query = ref("");
const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return GROUPS;
  return GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => item.words.includes(q)) })).filter(
    (group) => group.items.length > 0,
  );
});
</script>

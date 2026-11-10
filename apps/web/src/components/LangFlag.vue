<template>
  <img
    v-if="src"
    :src="src"
    alt=""
    aria-hidden="true"
    width="20"
    height="20"
    class="inline-block size-[1.25em] shrink-0 rounded-full object-cover align-[-0.25em] shadow-[0_0_0_1px_rgb(0_0_0/0.08)]"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { languageFlag } from "../lib/settings-store";

const props = defineProps<{ code: string }>();

// Only the files a page actually renders are fetched; the rest just sit in the build output.
const FLAGS = import.meta.glob<string>("../../node_modules/flag-icons/flags/1x1/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
});

// The language list stores an emoji flag; its two regional-indicator letters are the ISO country code.
function countryOf(emoji: string): string | null {
  const letters = [...emoji].map((char) => (char.codePointAt(0) ?? 0) - 0x1f1e6);
  if (letters.length !== 2 || letters.some((n) => n < 0 || n > 25)) return null;
  return letters.map((n) => String.fromCharCode(97 + n)).join("");
}

const src = computed(() => {
  const country = countryOf(languageFlag(props.code));
  return country ? FLAGS[`../../node_modules/flag-icons/flags/1x1/${country}.svg`] : undefined;
});
</script>

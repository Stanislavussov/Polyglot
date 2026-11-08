<template>
  <section v-if="notes" class="card mt-6" aria-labelledby="changes-title">
    <h2 id="changes-title" class="text-lg font-semibold">{{ t("web.changes.title") }}</h2>
    <p v-if="notes.length === 0" class="mt-2 text-sm text-ink-muted">{{ t("web.changes.empty") }}</p>
    <ul v-else class="mt-3 list-disc space-y-2 pl-5 text-sm">
      <li v-for="note in notes" :key="note">{{ note }}</li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../lib/api";
import { t } from "../lib/i18n";

// Release notes reach testers and admins only; everyone else gets 403 and sees no section.
const notes = ref<string[] | null>(null);

onMounted(async () => {
  try {
    notes.value = (await api.changes()).notes;
  } catch {
    notes.value = null;
  }
});
</script>

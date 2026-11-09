<template>
  <section class="card mt-6 space-y-4" aria-labelledby="report-title">
    <h2 id="report-title" class="text-xl font-semibold">{{ t("web.report.title") }}</h2>
    <p v-if="sent" role="status" class="text-sm text-primary-soft-fg">{{ t("web.report.sent") }}</p>
    <form v-else class="space-y-4" @submit.prevent="send">
      <div class="flex flex-wrap gap-2" role="radiogroup">
        <label
          v-for="option in TYPES"
          :key="option"
          class="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
        >
          <input v-model="type" type="radio" name="report-type" class="size-5 accent-primary" :value="option" />
          {{ t(`web.report.type.${option}`) }}
        </label>
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium" for="report-description">{{ t("web.report.description") }}</label>
        <textarea id="report-description" v-model="description" class="field min-h-28" :maxlength="MAX_LENGTH" required />
      </div>
      <p v-if="failed" role="alert" class="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{{ t("web.common.error") }}</p>
      <button type="submit" class="btn-primary" :disabled="sending || description.trim().length === 0">{{ t("web.report.send") }}</button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import type { IssueType } from "../lib/types";

const TYPES: IssueType[] = ["bug", "suggestion", "other"];
// The bot's report dialog takes no more than this.
const MAX_LENGTH = 1000;

const type = ref<IssueType>("bug");
const description = ref("");
const sending = ref(false);
const sent = ref(false);
const failed = ref(false);

async function send(): Promise<void> {
  sending.value = true;
  failed.value = false;
  try {
    await api.report(type.value, description.value.trim());
    sent.value = true;
  } catch {
    failed.value = true;
  } finally {
    sending.value = false;
  }
}
</script>

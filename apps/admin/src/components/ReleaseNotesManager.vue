<template>
  <div class="mt-6 space-y-8">
    <AlertMessage v-if="error">{{ error }}</AlertMessage>

    <section>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-gray-900">Waiting to be told</h2>
        <AppButton variant="link" :disabled="loading" @click="load">Refresh</AppButton>
      </div>

      <p v-if="loading" class="text-sm text-gray-400">Loading...</p>
      <p v-else-if="notes.length === 0" class="text-sm text-gray-400">
        Nothing pending — no release notes have been written since the last send.
      </p>

      <div v-else class="space-y-4">
        <article
          v-for="note in notes"
          :key="note.id"
          class="rounded-lg border bg-white p-4 shadow-sm transition-colors"
          :class="isSelected(note.id) ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-gray-200'"
        >
          <label class="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              class="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              :checked="isSelected(note.id)"
              @change="toggle(note.id)"
            />
            <span class="text-sm font-medium text-gray-900">{{ note.texts.en }}</span>
          </label>

          <div class="mt-3 grid gap-3 pl-7 sm:grid-cols-2">
            <div v-for="lang in languages" :key="lang">
              <label class="mb-1 block text-xs font-semibold tracking-wide text-gray-500 uppercase">{{ lang }}</label>
              <textarea
                v-model="drafts[note.id][lang]"
                rows="3"
                class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>
        </article>
      </div>
    </section>

    <section v-if="notes.length > 0" class="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p class="text-sm text-gray-600">
        Goes to <span class="font-semibold">admins and testers</span>, each in their own language. Anyone who already
        received a note will not get it twice.
      </p>
      <p v-if="sentMessage" class="mt-2 text-sm font-medium text-green-700">{{ sentMessage }}</p>

      <div class="mt-3 flex flex-wrap items-center gap-3">
        <AppButton v-if="!confirming" :disabled="selected.size === 0 || sending" @click="confirming = true">
          Send {{ selected.size }} note{{ selected.size === 1 ? "" : "s" }}
        </AppButton>
        <template v-else>
          <AppButton :disabled="sending" @click="send">{{ sending ? "Sending..." : "Confirm send" }}</AppButton>
          <AppButton variant="link" :disabled="sending" @click="confirming = false">Cancel</AppButton>
        </template>
      </div>
    </section>

    <section>
      <h2 class="mb-3 text-lg font-semibold text-gray-900">Recent sends</h2>
      <p v-if="jobs.length === 0" class="text-sm text-gray-400">Nothing has been sent yet.</p>
      <div v-else class="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table class="min-w-max divide-y divide-gray-200 sm:min-w-full">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">When</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">By</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Notes</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Status</th>
              <th class="px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-600 uppercase">Result</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="job in jobs" :key="job.id" class="transition-colors hover:bg-gray-50">
              <td class="px-4 py-3 text-sm whitespace-nowrap text-gray-500">{{ formatDate(job.createdAt) }}</td>
              <td class="px-4 py-3 text-sm text-gray-500">{{ job.createdBy ?? "—" }}</td>
              <td class="px-4 py-3 text-sm text-gray-900">{{ job.notes.length }}</td>
              <td class="px-4 py-3 text-sm">
                <span class="rounded-full px-2 py-1 text-xs font-medium" :class="statusClass(job.status)">
                  {{ job.status }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-gray-500">{{ formatResult(job) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { type ReleaseNoteItem, type ReleaseNoteJob, releaseNotes } from "../lib/api";
import AlertMessage from "./ui/AlertMessage.vue";
import AppButton from "./ui/AppButton.vue";

const notes = ref<ReleaseNoteItem[]>([]);
const languages = ref<string[]>([]);
const jobs = ref<ReleaseNoteJob[]>([]);
const selected = ref<Set<string>>(new Set());
/** Editable copy per note and language; what is sent, never written back to the repo. */
const drafts = reactive<Record<string, Record<string, string>>>({});
const loading = ref(false);
const sending = ref(false);
const confirming = ref(false);
const error = ref("");
const sentMessage = ref("");

function isSelected(id: string): boolean {
  return selected.value.has(id);
}

function toggle(id: string): void {
  const next = new Set(selected.value);
  if (!next.delete(id)) next.add(id);
  selected.value = next;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const data = await releaseNotes.list();
    notes.value = data.notes;
    languages.value = data.languages;
    jobs.value = data.jobs;
    for (const note of data.notes) {
      // Keep an edit the editor already made while only refreshing the rest.
      drafts[note.id] ??= Object.fromEntries(data.languages.map((lang) => [lang, note.texts[lang] ?? note.texts.en]));
    }
    selected.value = new Set([...selected.value].filter((id) => data.notes.some((note) => note.id === id)));
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load release notes";
  } finally {
    loading.value = false;
  }
}

async function send(): Promise<void> {
  sending.value = true;
  error.value = "";
  sentMessage.value = "";
  try {
    const payload = notes.value
      .filter((note) => selected.value.has(note.id))
      .map((note) => ({ id: note.id, texts: { ...drafts[note.id] } }));

    await releaseNotes.send(payload);
    sentMessage.value = "Queued — the bot sends it within a few seconds. Refresh to see the result.";
    selected.value = new Set();
    confirming.value = false;
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to queue the send";
  } finally {
    sending.value = false;
  }
}

function statusClass(status: ReleaseNoteJob["status"]): string {
  if (status === "sent") return "bg-green-100 text-green-800";
  if (status === "failed") return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-700";
}

function formatResult(job: ReleaseNoteJob): string {
  if (!job.result) return "—";
  if (typeof job.result.error === "string") return job.result.error;
  return `delivered ${job.result.delivered ?? 0}, failed ${job.result.failed ?? 0}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

onMounted(load);
</script>

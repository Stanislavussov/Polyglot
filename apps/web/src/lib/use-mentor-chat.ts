import { ref } from "vue";
import { ApiError } from "./api";
import { t } from "./i18n";
import { learnApi } from "./learn-api";
import { forgetThread, loadThreads, type MentorThread, newThread, saveThread } from "./mentor-threads";

export const MAX_MENTOR_QUESTION = 1000;
// The bot's mentor window; the server trims to it too, this keeps the request small.
const MAX_WINDOW = 20;

export function useMentorChat() {
  const threads = ref<MentorThread[]>(loadThreads());
  const current = ref<MentorThread>(newThread(""));
  const busy = ref(false);
  // The question on its way, shown in the chat before the answer arrives.
  const pending = ref<string | null>(null);
  const lockedHint = ref(false);
  const limit = ref<{ reason?: "plan" | "daily_ceiling"; resetAt?: string } | null>(null);
  const errorText = ref<string | null>(null);

  function resetNotices(): void {
    lockedHint.value = false;
    limit.value = null;
    errorText.value = null;
  }

  function startNew(): void {
    current.value = newThread("");
    resetNotices();
  }

  function resume(thread: MentorThread): void {
    current.value = { ...thread, turns: [...thread.turns] };
    resetNotices();
  }

  function forget(id: string): void {
    threads.value = forgetThread(threads.value, id);
    if (current.value.id === id) startNew();
  }

  function clear(): void {
    threads.value = forgetThread(threads.value, null);
    startNew();
  }

  /** True when the mentor answered, so the caller can clear its box. */
  async function ask(question: string): Promise<boolean> {
    const text = question.trim();
    if (!text || busy.value) return false;
    resetNotices();
    busy.value = true;
    pending.value = text;
    const thread = current.value.turns.length === 0 ? { ...newThread(text), id: current.value.id } : current.value;
    try {
      const { answer } = await learnApi.mentorChat(text, thread.turns.slice(-MAX_WINDOW));
      const turns = [
        ...thread.turns,
        { role: "user" as const, content: text },
        { role: "assistant" as const, content: answer },
      ];
      current.value = { ...thread, turns, updatedAt: Date.now() };
      threads.value = saveThread(threads.value, current.value);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "feature_locked") lockedHint.value = true;
      else if (err instanceof ApiError && err.code === "mentor_limit")
        errorText.value = t("web.learn.mentor.limit", { limit: err.body.limit ?? "" });
      else if (err instanceof ApiError && err.code === "limit")
        limit.value = { reason: err.body.reason as "plan" | "daily_ceiling", resetAt: err.body.resetAt };
      else if (err instanceof ApiError && err.code === "too_long")
        errorText.value = t("web.learn.mentor.tooLong", { max: MAX_MENTOR_QUESTION });
      else errorText.value = t("web.learn.mentor.error");
      return false;
    } finally {
      busy.value = false;
      pending.value = null;
    }
  }

  return {
    threads,
    current,
    busy,
    pending,
    lockedHint,
    limit,
    errorText,
    ask,
    startNew,
    resume,
    forget,
    clear,
    resetNotices,
  };
}

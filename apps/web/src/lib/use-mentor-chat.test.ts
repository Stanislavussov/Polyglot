/**
 * Spec — the mentor conversation, shared by the Mentor page and the translate page's mentor mode.
 *
 * 1. A question goes to the mentor with the thread so far; question and answer join the thread,
 *    and the thread is kept as a past topic.
 * 2. A failed question leaves the thread as it was and says why: locked plan, daily mentor limit,
 *    plan limit, too long, anything else.
 * 3. "New topic" starts an empty thread; an earlier thread can be resumed.
 * 4. Nothing is sent while a question is on its way, and a blank question is not sent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";

const mentorChat = vi.fn();
vi.mock("./learn-api", () => ({ learnApi: { mentorChat: (...args: unknown[]) => mentorChat(...args) } }));
vi.mock("./i18n", () => ({ t: (key: string) => key }));

const { useMentorChat } = await import("./use-mentor-chat");

beforeEach(() => {
  mentorChat.mockReset();
});

describe("useMentorChat", () => {
  it("adds the question and the answer to the thread and keeps it as a topic", async () => {
    mentorChat.mockResolvedValue({ question: "q", answer: "Because." });
    const chat = useMentorChat();
    expect(await chat.ask("Why ser?")).toBe(true);
    expect(chat.current.value.turns).toEqual([
      { role: "user", content: "Why ser?" },
      { role: "assistant", content: "Because." },
    ]);
    expect(chat.current.value.title).toBe("Why ser?");
    expect(chat.threads.value[0]?.id).toBe(chat.current.value.id);

    mentorChat.mockResolvedValue({ question: "q", answer: "Sure." });
    await chat.ask("And estar?");
    expect(mentorChat).toHaveBeenLastCalledWith("And estar?", [
      { role: "user", content: "Why ser?" },
      { role: "assistant", content: "Because." },
    ]);
  });

  it.each([
    ["feature_locked", () => new ApiError(403, { code: "feature_locked" }), "lockedHint"],
    ["mentor_limit", () => new ApiError(429, { code: "mentor_limit", limit: 5 }), "errorText"],
    ["limit", () => new ApiError(429, { code: "limit", reason: "plan" }), "limit"],
    ["too_long", () => new ApiError(422, { code: "too_long" }), "errorText"],
    ["network", () => new Error("boom"), "errorText"],
  ] as const)("keeps the thread and explains a failure: %s", async (_name, error, notice) => {
    mentorChat.mockImplementation(async () => {
      throw error();
    });
    const chat = useMentorChat();
    expect(await chat.ask("Why?")).toBe(false);
    expect(chat.current.value.turns).toEqual([]);
    expect(chat[notice].value).toBeTruthy();
  });

  it("starts a new topic and resumes an earlier one", async () => {
    mentorChat.mockResolvedValue({ question: "q", answer: "A." });
    const chat = useMentorChat();
    await chat.ask("First");
    const first = chat.current.value;
    chat.startNew();
    expect(chat.current.value.turns).toEqual([]);
    expect(chat.earlier.value.map((thread) => thread.id)).toContain(first.id);
    chat.resume(first);
    expect(chat.current.value.turns).toHaveLength(2);
  });

  it("sends nothing blank or while busy", async () => {
    let finish: (value: unknown) => void = () => {};
    mentorChat.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const chat = useMentorChat();
    expect(await chat.ask("   ")).toBe(false);
    const first = chat.ask("One");
    expect(await chat.ask("Two")).toBe(false);
    finish({ question: "q", answer: "A." });
    await first;
    expect(mentorChat).toHaveBeenCalledTimes(1);
  });
});
